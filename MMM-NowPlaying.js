/* MMM-NowPlaying / MMM-NowPlaying.js
 *
 * Displays what's playing on Google Nest / Cast speakers on the local network.
 * - Single active speaker  → big card (album art, title, artist, controls)
 * - Multiple active speakers → stacked list with thumbnails
 */

Module.register("MMM-NowPlaying", {

	defaults: {
		pollInterval:    5000,
		updateFadeSpeed: 500,
		maxWidth:        "360px",
		showAlbum:       true,
		devices:         []   // optional: [{ name, host, port }] to skip mDNS
	},

	// ---- lifecycle -------------------------------------------------

	start: function () {
		this.playing = [];
		this.loaded  = false;
		this.sendSocketNotification("NOWPLAYING_INIT", this.config);
	},

	getStyles: function () {
		return ["MMM-NowPlaying.css"];
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "NOWPLAYING_STATE") {
			this.playing = payload.playing || [];
			this.loaded  = true;
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

		// ---- Album art ----
		const artWrap = document.createElement("div");
		artWrap.className = "nowplaying-art-wrap";
		if (device.artUrl) {
			const img = document.createElement("img");
			img.className = "nowplaying-art-img";
			img.src = device.artUrl;
			img.alt = "";
			artWrap.appendChild(img);
		} else {
			artWrap.classList.add("nowplaying-art-placeholder");
			artWrap.textContent = "♪";
		}
		card.appendChild(artWrap);

		// ---- Info ----
		const info = document.createElement("div");
		info.className = "nowplaying-info";

		const title = document.createElement("div");
		title.className = "nowplaying-title";
		title.textContent = device.title || "Unknown";
		info.appendChild(title);

		if (device.artist) {
			const artist = document.createElement("div");
			artist.className = "nowplaying-artist";
			artist.textContent = device.artist;
			info.appendChild(artist);
		}

		if (this.config.showAlbum && device.album) {
			const album = document.createElement("div");
			album.className = "nowplaying-album";
			album.textContent = device.album;
			info.appendChild(album);
		}

		const deviceLabel = document.createElement("div");
		deviceLabel.className = "nowplaying-device-label";
		deviceLabel.textContent = device.deviceName;
		info.appendChild(deviceLabel);

		card.appendChild(info);

		// ---- Controls ----
		card.appendChild(this.buildControls(device));

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

		// Info
		const info = document.createElement("div");
		info.className = "nowplaying-list-info";

		const row = document.createElement("div");
		row.className = "nowplaying-list-title-row";

		const titleSpan = document.createElement("span");
		titleSpan.className = "nowplaying-list-title";
		titleSpan.textContent = device.title || "Unknown";
		row.appendChild(titleSpan);

		const badge = document.createElement("span");
		badge.className = "nowplaying-list-device";
		badge.textContent = device.deviceName;
		row.appendChild(badge);

		info.appendChild(row);

		if (device.artist) {
			const artist = document.createElement("div");
			artist.className = "nowplaying-list-artist";
			artist.textContent = device.artist;
			info.appendChild(artist);
		}

		item.appendChild(info);

		// Controls — compact version reusing buildControls()
		const controls = this.buildControls(device);
		controls.classList.add("nowplaying-list-controls");
		info.appendChild(controls);

		return item;
	}
});
