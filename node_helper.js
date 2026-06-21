/* MMM-NowPlaying / node_helper.js
 *
 * - Discovers Google Cast / Nest speakers via mDNS (bonjour-service)
 * - Polls each device every pollInterval ms using the Cast v2 protocol
 * - Pushes now-playing state to the front-end module
 * - Handles play / pause / stop / next / prev commands from the mirror
 */

"use strict";

const NodeHelper = require("node_helper");
const { Client, DefaultMediaReceiver } = require("castv2-client");
const { Bonjour } = require("bonjour-service");

module.exports = NodeHelper.create({

	// ---- lifecycle -------------------------------------------------

	start: function () {
		this.devices  = {};   // host -> { name, host, port }
		this.playing  = {};   // host -> media state
		this.inFlight = {};   // host -> bool  (poll guard)
		this.pollTimer = null;
		this.bonjour   = null;
		console.log("[MMM-NowPlaying] helper started");
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "NOWPLAYING_INIT") {
			this.config = payload;
			this.startDiscovery();
			this.startPolling();
		} else if (notification === "NOWPLAYING_CONTROL") {
			this.sendControl(payload.host, payload.action);
		}
	},

	stop: function () {
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.bonjour) {
			try { this.bonjour.destroy(); } catch (_) {}
		}
	},

	// ---- discovery -------------------------------------------------

	startDiscovery: function () {
		// Manually-configured devices are always registered first
		(this.config.devices || []).forEach(d => {
			this.devices[d.host] = {
				name: d.name || d.host,
				host: d.host,
				port: d.port || 8009
			};
		});

		// Auto-discover via mDNS
		try {
			this.bonjour = new Bonjour();
			const browser = this.bonjour.find({ type: "googlecast" });

			browser.on("up", (svc) => {
				// Prefer IPv4
				const host = (svc.addresses || []).find(a => !a.includes(":")) || svc.host;
				if (!host) return;
				const name = (svc.txt && svc.txt.fn) || svc.name;
				this.devices[host] = { name, host, port: svc.port || 8009 };
				console.log(`[MMM-NowPlaying] discovered: "${name}" at ${host}`);
			});

			browser.on("down", (svc) => {
				const host = (svc.addresses || []).find(a => !a.includes(":")) || svc.host;
				if (host && this.playing[host]) {
					delete this.playing[host];
					this.sendState();
				}
			});
		} catch (err) {
			console.error("[MMM-NowPlaying] mDNS discovery failed:", err.message);
		}
	},

	// ---- polling ---------------------------------------------------

	startPolling: function () {
		const ms = (this.config && this.config.pollInterval) || 5000;
		// Give mDNS ~2 s to discover before first poll
		setTimeout(() => this.pollAll(), 2000);
		this.pollTimer = setInterval(() => this.pollAll(), ms);
	},

	pollAll: function () {
		Object.values(this.devices).forEach(device => {
			if (!this.inFlight[device.host]) this.pollDevice(device);
		});
	},

	pollDevice: function (device) {
		this.inFlight[device.host] = true;
		const client = new Client();
		let settled = false;

		const settle = (state) => {
			if (settled) return;
			settled = true;
			this.inFlight[device.host] = false;
			try { client.close(); } catch (_) {}

			const prevJson = JSON.stringify(this.playing[device.host]);

			if (state && state.playerState !== "IDLE") {
				this.playing[device.host] = state;
			} else {
				delete this.playing[device.host];
			}

			if (JSON.stringify(this.playing[device.host]) !== prevJson) {
				this.sendState();
			}
		};

		// Hard timeout — don't hang if the device is unresponsive
		const timer = setTimeout(() => settle(null), 4500);

		client.on("error", () => {
			clearTimeout(timer);
			settle(null);
		});

		client.connect({ host: device.host, port: device.port || 8009 }, () => {
			client.getStatus((err, status) => {
				if (err || !status || !(status.applications || []).length) {
					clearTimeout(timer);
					return settle(null);
				}

				client.join(status.applications[0], DefaultMediaReceiver, (err, player) => {
					if (err) {
						clearTimeout(timer);
						return settle(null);
					}

					player.getStatus((err, ms) => {
						clearTimeout(timer);

						if (err || !ms || ms.playerState === "IDLE") {
							return settle(null);
						}

						const meta   = (ms.media && ms.media.metadata) || {};
						const images = meta.images || [];

						settle({
							deviceName:  device.name,
							host:        device.host,
							title:       meta.title       || "",
							artist:      meta.artist      || meta.albumArtist || meta.subtitle || "",
							album:       meta.albumName   || "",
							artUrl:      images.length ? images[0].url : null,
							playerState: ms.playerState,   // PLAYING | PAUSED | BUFFERING
							contentId:   (ms.media && ms.media.contentId) || ""
						});
					});
				});
			});
		});
	},

	// ---- transport controls ----------------------------------------

	sendControl: function (host, action) {
		const device = this.devices[host];
		if (!device) return;

		const client = new Client();
		let done = false;

		const finish = () => {
			if (done) return;
			done = true;
			try { client.close(); } catch (_) {}
			// Re-poll after a short pause so the display reflects the change
			setTimeout(() => {
				if (this.devices[host] && !this.inFlight[host]) {
					this.pollDevice(this.devices[host]);
				}
			}, 800);
		};

		setTimeout(finish, 5000); // safety timeout
		client.on("error", finish);

		client.connect({ host: device.host, port: device.port || 8009 }, () => {
			client.getStatus((err, status) => {
				if (err || !(status.applications || []).length) return finish();

				client.join(status.applications[0], DefaultMediaReceiver, (err, player) => {
					if (err) return finish();

					// Must call getStatus() first so castv2-client learns the
					// current mediaSessionId — commands sent without it are ignored.
					player.getStatus((err) => {
						if (err) return finish();

						switch (action) {
							case "play":  player.play(finish);  break;
							case "pause": player.pause(finish); break;
							case "stop":  player.stop(finish);  break;

							// Queue skip — works with YouTube Music, Spotify, etc.
							// castv2-client may not expose sessionRequest on all versions;
							// wrap in try/catch so unsupported apps fail silently.
							case "next":
								try {
									player.media.sessionRequest(
										{ type: "QUEUE_UPDATE", jump: 1 }, finish
									);
								} catch (_) { finish(); }
								break;
							case "prev":
								try {
									player.media.sessionRequest(
										{ type: "QUEUE_UPDATE", jump: -1 }, finish
									);
								} catch (_) { finish(); }
								break;

							default: finish();
						}
					});
				});
			});
		});
	},

	// ---- state broadcast -------------------------------------------

	sendState: function () {
		const playing = Object.values(this.playing)
			.filter(p => p.playerState !== "IDLE");
		this.sendSocketNotification("NOWPLAYING_STATE", { playing });
	}
});
