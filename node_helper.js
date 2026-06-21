/* MMM-NowPlaying / node_helper.js
 *
 * - Discovers Google Cast / Nest speakers via mDNS (bonjour-service)
 * - Persists discovered devices to data/devices.json so they survive restarts
 * - Polls each device every pollInterval ms using the Cast v2 protocol
 * - Pushes now-playing state to the front-end module
 * - Handles play / pause / stop / next / prev commands from the mirror
 * - Runs an admin express server for device management and rediscovery
 */

"use strict";

const NodeHelper = require("node_helper");
const express    = require("express");
const fs         = require("fs");
const path       = require("path");
const { Client, DefaultMediaReceiver } = require("castv2-client");
const { Bonjour } = require("bonjour-service");

module.exports = NodeHelper.create({

	// ---- lifecycle -------------------------------------------------

	start: function () {
		this.devices     = {};   // host -> { name, host, port, lastSeen }
		this.playing     = {};   // host -> media state
		this.inFlight    = {};   // host -> bool  (poll guard)
		this.pollTimer   = null;
		this.bonjour     = null;
		this.adminServer = null;

		this.dataDir     = path.join(this.path, "data");
		this.devicesFile = path.join(this.dataDir, "devices.json");

		this.ensureDataDir();
		this.loadCachedDevices();
		console.log("[MMM-NowPlaying] helper started");
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "NOWPLAYING_INIT") {
			this.config = payload;
			this.startDiscovery();
			this.startPolling();
			this.startAdminServer();
		} else if (notification === "NOWPLAYING_CONTROL") {
			this.sendControl(payload.host, payload.action);
		}
	},

	stop: function () {
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.bonjour) { try { this.bonjour.destroy(); } catch (_) {} }
		if (this.adminServer) { try { this.adminServer.close(); } catch (_) {} }
	},

	// ---- data helpers ----------------------------------------------

	ensureDataDir: function () {
		if (!fs.existsSync(this.dataDir)) {
			fs.mkdirSync(this.dataDir, { recursive: true });
		}
	},

	loadCachedDevices: function () {
		try {
			if (!fs.existsSync(this.devicesFile)) return;
			const raw = fs.readFileSync(this.devicesFile, "utf8");
			const data = JSON.parse(raw);
			Object.values(data.devices || {}).forEach(d => {
				this.devices[d.host] = d;
			});
			console.log(`[MMM-NowPlaying] loaded ${Object.keys(this.devices).length} cached device(s)`);
		} catch (err) {
			console.error("[MMM-NowPlaying] failed to load cached devices:", err.message);
		}
	},

	saveCachedDevices: function () {
		try {
			this.ensureDataDir();
			fs.writeFileSync(this.devicesFile, JSON.stringify({ devices: this.devices }, null, 2));
		} catch (err) {
			console.error("[MMM-NowPlaying] failed to save devices:", err.message);
		}
	},

	// ---- discovery -------------------------------------------------

	startDiscovery: function () {
		// Manually-configured devices always take precedence
		(this.config.devices || []).forEach(d => {
			this.devices[d.host] = {
				name:     d.name || d.host,
				host:     d.host,
				port:     d.port || 8009,
				lastSeen: new Date().toISOString()
			};
		});

		this.setupBonjour();
	},

	setupBonjour: function () {
		if (this.bonjour) {
			try { this.bonjour.destroy(); } catch (_) {}
			this.bonjour = null;
		}

		try {
			this.bonjour = new Bonjour();
			const browser = this.bonjour.find({ type: "googlecast" });

			browser.on("up", (svc) => {
				const host = (svc.addresses || []).find(a => !a.includes(":")) || svc.host;
				if (!host) return;
				const name = (svc.txt && svc.txt.fn) || svc.name;
				this.devices[host] = { name, host, port: svc.port || 8009, lastSeen: new Date().toISOString() };
				this.saveCachedDevices();
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

	triggerRediscover: function () {
		console.log("[MMM-NowPlaying] rediscovering...");
		// Small delay to let the old browser fully shut down
		setTimeout(() => this.setupBonjour(), 300);
	},

	// ---- polling ---------------------------------------------------

	startPolling: function () {
		const ms = (this.config && this.config.pollInterval) || 5000;
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

		const timer = setTimeout(() => settle(null), 4500);

		client.on("error", () => { clearTimeout(timer); settle(null); });

		client.connect({ host: device.host, port: device.port || 8009 }, () => {
			client.getStatus((err, status) => {
				if (err || !status || !(status.applications || []).length) {
					clearTimeout(timer);
					return settle(null);
				}

				client.join(status.applications[0], DefaultMediaReceiver, (err, player) => {
					if (err) { clearTimeout(timer); return settle(null); }

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
							playerState: ms.playerState,
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
			setTimeout(() => {
				if (this.devices[host] && !this.inFlight[host]) {
					this.pollDevice(this.devices[host]);
				}
			}, 800);
		};

		setTimeout(finish, 5000);
		client.on("error", finish);

		client.connect({ host: device.host, port: device.port || 8009 }, () => {
			client.getStatus((err, status) => {
				if (err || !(status.applications || []).length) return finish();

				client.join(status.applications[0], DefaultMediaReceiver, (err, player) => {
					if (err) return finish();

					player.getStatus((err) => {
						if (err) return finish();

						switch (action) {
							case "play":  player.play(finish);  break;
							case "pause": player.pause(finish); break;
							case "stop":  player.stop(finish);  break;
							case "next":
								try { player.media.sessionRequest({ type: "QUEUE_UPDATE", jump:  1 }, finish); }
								catch (_) { finish(); }
								break;
							case "prev":
								try { player.media.sessionRequest({ type: "QUEUE_UPDATE", jump: -1 }, finish); }
								catch (_) { finish(); }
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
	},

	// ---- admin server ----------------------------------------------

	startAdminServer: function () {
		if (this.adminServer) return;

		const port = (this.config && this.config.adminPort) || 8083;
		const app  = express();

		app.use(express.json());
		app.use(express.static(path.join(this.path, "admin", "public")));

		// All known devices + current playing state
		app.get("/api/state", (req, res) => {
			const devices = Object.values(this.devices).map(d => ({
				name:     d.name,
				host:     d.host,
				port:     d.port,
				lastSeen: d.lastSeen || null,
				playing:  this.playing[d.host] || null
			}));
			// Sort: playing first, then alphabetically
			devices.sort((a, b) => {
				if (a.playing && !b.playing) return -1;
				if (!a.playing && b.playing) return  1;
				return a.name.localeCompare(b.name);
			});
			res.json({ devices });
		});

		// Trigger a fresh mDNS scan
		app.post("/api/rediscover", (req, res) => {
			this.triggerRediscover();
			res.json({ ok: true });
		});

		// Add a device manually
		app.post("/api/devices", (req, res) => {
			const { name, host, port } = req.body || {};
			if (!host) return res.status(400).json({ error: "host is required" });
			this.devices[host] = {
				name:     name || host,
				host,
				port:     port || 8009,
				lastSeen: new Date().toISOString(),
				manual:   true
			};
			this.saveCachedDevices();
			res.json({ ok: true });
		});

		// Remove a stale device from the cache
		app.delete("/api/devices/:host", (req, res) => {
			const host = req.params.host;
			delete this.devices[host];
			delete this.playing[host];
			this.saveCachedDevices();
			this.sendState();
			res.json({ ok: true });
		});

		this.adminServer = app.listen(port, () => {
			console.log(`[MMM-NowPlaying] admin portal on port ${port}`);
		});
	}
});
