/* MMM-NowPlaying / MMM-NowPlaying.js
 *
 * Displays what's playing on Google Nest / Cast speakers on the local network.
 * - Single active speaker  → big card (album art, title, artist, controls)
 * - Multiple active speakers → stacked list with thumbnails
 */

Module.register("MMM-NowPlaying", {

	defaults: {
		adminPort:       8083,
		pollInterval:    5000,
		updateFadeSpeed: 500,
		maxWidth:        "360px",
		showAlbum:       true,
		devices:         []   // optional: [{ name, host, port }] to skip mDNS
	},

	// ---- lifecycle -------------------------------------------------

	start: function () {
		this.playing  = [];
		this.loaded   = false;
		this.settings = {};
		this.sendSocketNotification("NOWPLAYING_INIT", this.config);
	},

	getStyles: function () {
		return ["MMM-NowPlaying.css"];
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "NOWPLAYING_STATE") {
			if (payload.settings) this.settings = payload.settings;
			const incoming = payload.playing || [];

			// During a track transition the Cast device briefly returns
			// empty metadata. Keep the previous title/art visible until
			// the new track's metadata actually arrives.
			this.playing = incoming.map(next => {
				if (!next.title && !next.artist) {
					const prev = this.playing.find(p => p.host === next.host);
					if (prev) {
						return Object.assign({}, next, {
							title:  prev.title,
							artist: prev.artist,
							album:  prev.album,
							artUrl: next.artUrl || prev.artUrl
						});
					}
				}
				return next;
			});

			this.loaded = true;
			this.updateDom(this.config.updateFadeSpeed);
		}
	},

	// ---- rendering -------------------------------------------------

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-nowplaying-wrapper";
		wrapper.style.maxWidth = this.config.maxWidth;

		if (!this.loaded || this.playing.length === 0) {
			return wrapper; // show nothing when idle
		}

		if (this.playing.length === 1) {
			wrapper.appendChild(this.buildCard(this.playing[0]));
		} else {
			const list = document.createElement("div");
			list.className = "nowplaying-list";
			this.playing.forEach(d => list.appendChild(this.buildListItem(d)));
			wrapper.appendChild(list);
		}

		return wrapper;
	},

	buildCard: function (device) {
		const card = document.createElement("div");
		card.className = "nowplaying-card";
		if (device.playerState === "PAUSED") card.classList.add("paused");

		// Art — fills card as background layer
		const artWrap = document.createElement("div");
		artWrap.className = "nowplaying-art-wrap";
		if (device.artUrl) {
			const img = document.createElement("img");
			img.className = "nowplaying-art-img";
			img.src = device.artUrl;
			img.alt = "";
			const opacity = (this.settings && this.settings.artOpacity !== undefined)
				? this.settings.artOpacity : 0.75;
			img.style.opacity = opacity;
			artWrap.appendChild(img);
		} else {
			const ph = document.createElement("div");
			ph.className = "nowplaying-art-placeholder";
			ph.textContent = "♪";
			artWrap.appendChild(ph);
		}
		card.appendChild(artWrap);

		// Gradient overlay for text legibility
		const overlay = document.createElement("div");
		overlay.className = "nowplaying-art-overlay";
		card.appendChild(overlay);

		// Foreground text + controls
		const body = document.createElement("div");
		body.className = "nowplaying-card-body";

		const title = document.createElement("div");
		title.className = "nowplaying-title";
		title.textContent = device.title || "Unknown";
		body.appendChild(title);

		const subParts = [device.artist];
		if (this.config.showAlbum && device.album) subParts.push(device.album);
		const subText = subParts.filter(Boolean).join("  ·  ");
		if (subText) {
			const sub = document.createElement("div");
			sub.className = "nowplaying-sub";
			sub.textContent = subText;
			body.appendChild(sub);
		}

		const deviceLabel = document.createElement("div");
		deviceLabel.className = "nowplaying-device-label";
		deviceLabel.textContent = device.deviceName;
		body.appendChild(deviceLabel);

		body.appendChild(this.buildControls(device));

		card.appendChild(body);
		return card;
	},

	buildControls: function (device) {
		const controls = document.createElement("div");
		controls.className = "nowplaying-controls";

		const isPlaying = device.playerState === "PLAYING" || device.playerState === "BUFFERING";

		const buttons = [
			{ action: "prev",  label: "⏮", cls: "" },
			{ action: isPlaying ? "pause" : "play",
			  label:  isPlaying ? "⏸"    : "▶",
			  cls: "primary" },
			{ action: "next",  label: "⏭", cls: "" },
			{ action: "stop",  label: "⏹", cls: "" }
		];

		buttons.forEach(def => {
			const btn = document.createElement("button");
			btn.className = "nowplaying-btn" + (def.cls ? " nowplaying-btn-" + def.cls : "");
			btn.textContent = def.label;
			btn.addEventListener("click", () => {
				this.sendSocketNotification("NOWPLAYING_CONTROL", {
					host:   device.host,
					action: def.action
				});
				// Optimistic state flip for play/pause
				if (def.action === "pause") {
					device.playerState = "PAUSED";
					this.updateDom(0);
				} else if (def.action === "play") {
					device.playerState = "PLAYING";
					this.updateDom(0);
				}
			});
			controls.appendChild(btn);
		});

		return controls;
	},

	buildListItem: function (device) {
		const item = document.createElement("div");
		item.className = "nowplaying-list-item";
		if (device.playerState === "PAUSED") item.classList.add("paused");

		// Thumbnail
		if (device.artUrl) {
			const thumb = document.createElement("img");
			thumb.className = "nowplaying-list-thumb";
			thumb.src = device.artUrl;
			thumb.alt = "";
			item.appendChild(thumb);
		} else {
			const ph = document.createElement("div");
			ph.className = "nowplaying-list-thumb nowplaying-list-thumb-ph";
			ph.textContent = "♪";
			item.appendChild(ph);
		}

		// Info panel — 3 rows distributed to match thumbnail height
		const info = document.createElement("div");
		info.className = "nowplaying-list-info";

		// Row 1: speaker name
		const deviceEl = document.createElement("div");
		deviceEl.className = "nowplaying-list-device";
		deviceEl.textContent = device.deviceName;
		info.appendChild(deviceEl);

		// Row 2: Song — Artist on one line
		const track = document.createElement("div");
		track.className = "nowplaying-list-track";
		const parts = [device.title || "Playing", device.artist].filter(Boolean);
		track.textContent = parts.join("  —  ");
		info.appendChild(track);

		// Row 3: compact controls
		const controls = this.buildControls(device);
		controls.classList.add("nowplaying-list-controls");
		info.appendChild(controls);

		item.appendChild(info);
		return item;
	}
});
