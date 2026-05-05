const ROOT = `systems/aborea-v7`;
const PRESETS_PATH = `${ROOT}/data/audio-presets.json`;

export class AboreaSoundboard {
  static state = {
    ambience:    null,
    music:       null,
    presetId:    null,
    musicList:   [],
    musicIndex:  0,
    _uiInterval: null
  };

  static async loadPresets() {
    if (this._presets) return this._presets;
    const response = await foundry.utils.fetchWithTimeout(PRESETS_PATH);
    const json = await response.json();
    // Support grouped structure { groups: [...] } and legacy flat { presets: [...] }
    if (json.groups) {
      this._groups  = json.groups;
      this._presets = json.groups.flatMap(g =>
        g.presets.map(p => ({ ...p, group: g.id, groupLabel: g.label }))
      );
    } else {
      this._groups  = [{ id: "default", label: "Presets", presets: json.presets || [] }];
      this._presets = json.presets || [];
    }
    return this._presets;
  }

  static async loadGroups() {
    await this.loadPresets();
    return this._groups ?? [];
  }

  static randomFrom(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  static normalizePath(src) {
    if (!src) return src;
    if (/^(https?:|data:|systems\/|modules\/|worlds\/)/.test(src)) return src;
    return `${ROOT}/${src.replace(/^\/+/, "")}`;
  }

  static async playFile(src, { loop = false, volume = 0.5, fade = 500 } = {}) {
    src = this.normalizePath(src);
    if (!src) return null;
    return await foundry.audio.AudioHelper.play({ src, loop, volume, fade, autoplay: true }, true);
  }

  static async stopSound(sound, fade = 500) {
    if (!sound) return;
    try { await sound.fade(0, { duration: fade }); } catch (e) {}
    try { sound.stop(); } catch (e) {}
  }

  static async stopAll(fade = 500) {
    this._stopUIUpdates();
    await this.stopSound(this.state.ambience, fade);
    await this.stopSound(this.state.music, fade);
    this.state.ambience   = null;
    this.state.music      = null;
    this.state.presetId   = null;
    this.state.musicList  = [];
    this.state.musicIndex = 0;
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  static async playPreset(presetId) {
    const presets = await this.loadPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return ui.notifications?.error(`ABOREA Audio: Unbekanntes Preset ${presetId}`);

    await this.stopAll(700);

    this.state.musicList  = preset.music?.length ? [...preset.music] : [];
    this.state.musicIndex = 0;

    const ambienceSrc = this.randomFrom(preset.ambience);
    const ambienceVol = Number(game.settings.get("aborea-v7", "audioAmbienceVolume") ?? 0.45);
    const musicVol    = Number(game.settings.get("aborea-v7", "audioMusicVolume")    ?? 0.35);

    this.state.ambience = await this.playFile(ambienceSrc, { loop: true,  volume: ambienceVol, fade: 800  });
    this.state.music    = await this._startMusicTrack(this.state.musicList[0], musicVol, 1200);
    this.state.presetId = preset.id;

    ChatMessage.create({ content: `<strong>ABOREA Audio</strong><br>Szene gestartet: ${preset.label}` });
  }

  static async _startMusicTrack(src, volume, fade = 500) {
    if (!src) return null;
    const sound = await this.playFile(src, { loop: false, volume, fade });
    if (sound) {
      // Auto-advance when track ends
      const advance = () => { if (this.state.music === sound) this.playNextTrack(); };
      try { sound.addEventListener("end", advance); } catch (_) {}
      try { sound.on?.("end", advance); } catch (_) {}
    }
    return sound;
  }

  static async playNextTrack() {
    if (!this.state.musicList.length) return;
    this.state.musicIndex = (this.state.musicIndex + 1) % this.state.musicList.length;
    await this._switchTrack();
  }

  static async playPrevTrack() {
    if (!this.state.musicList.length) return;
    // < 3s in: go to previous track; >= 3s: restart current
    const pos = this._getSoundPosition(this.state.music);
    if (pos >= 3) {
      this._seekSound(this.state.music, 0);
      return;
    }
    this.state.musicIndex = (this.state.musicIndex - 1 + this.state.musicList.length) % this.state.musicList.length;
    await this._switchTrack();
  }

  static async _switchTrack() {
    await this.stopSound(this.state.music, 300);
    const src = this.state.musicList[this.state.musicIndex];
    const vol = Number(game.settings.get("aborea-v7", "audioMusicVolume") ?? 0.35);
    this.state.music = await this._startMusicTrack(src, vol, 400);
  }

  // ── One-Shot ────────────────────────────────────────────────────────────────

  static async playOneShotFromPreset(presetId) {
    const presets = await this.loadPresets();
    const preset = presets.find(p => p.id === presetId || p.id === this.state.presetId);
    if (!preset) return ui.notifications?.warn("ABOREA Audio: Kein Preset aktiv.");
    const src = this.randomFrom(preset.oneshots);
    const vol = Number(game.settings.get("aborea-v7", "audioOneShotVolume") ?? 0.7);
    if (!src) return ui.notifications?.warn("ABOREA Audio: Für dieses Preset ist kein One-Shot definiert.");
    await this.playFile(src, { loop: false, volume: vol, fade: 0 });
  }

  // ── Seek / Position helpers ──────────────────────────────────────────────────

  static _getSoundPosition(sound) {
    if (!sound) return 0;
    try { return sound.currentTime ?? 0; } catch (_) { return 0; }
  }

  static _getSoundDuration(sound) {
    if (!sound) return 0;
    try { return sound.duration ?? sound.buffer?.duration ?? 0; } catch (_) { return 0; }
  }

  static _seekSound(sound, seconds) {
    if (!sound) return;
    try {
      if (typeof sound.seek === "function") { sound.seek(seconds); return; }
      sound.currentTime = seconds;
    } catch (_) {}
  }

  static _formatTime(s) {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, "0");
    return `${m}:${sec}`;
  }

  // ── UI update loop ───────────────────────────────────────────────────────────

  static _startUIUpdates(rootEl) {
    this._stopUIUpdates();
    this.state._uiInterval = setInterval(() => {
      const sound   = this.state.music;
      const slider  = rootEl.querySelector(".aborea-seek-slider");
      const timeEl  = rootEl.querySelector(".aborea-track-time");
      const nameEl  = rootEl.querySelector(".aborea-track-name");
      if (!slider) { this._stopUIUpdates(); return; }

      if (sound) {
        const cur = this._getSoundPosition(sound);
        const dur = this._getSoundDuration(sound);
        if (dur > 0 && !slider.dataset.seeking) {
          slider.max   = 1000;
          slider.value = Math.round((cur / dur) * 1000);
        }
        if (timeEl) timeEl.textContent = `${this._formatTime(cur)} / ${this._formatTime(dur)}`;
        if (nameEl) {
          const src   = this.state.musicList[this.state.musicIndex] ?? "";
          const fname = src.split("/").pop().replace(/\.[^.]+$/, "").replace(/_/g, " ");
          nameEl.textContent = fname || "—";
        }
      } else {
        slider.value = 0;
        if (timeEl) timeEl.textContent = "0:00 / 0:00";
        if (nameEl) nameEl.textContent = "—";
      }
    }, 500);
  }

  static _stopUIUpdates() {
    if (this.state._uiInterval) {
      clearInterval(this.state._uiInterval);
      this.state._uiInterval = null;
    }
  }

  // ── Dialog ──────────────────────────────────────────────────────────────────

  static async openDialog() {
    const groups   = await this.loadGroups();
    const presets  = await this.loadPresets();
    const activeId = this.state.presetId || presets[0]?.id || "";
    const html     = await renderTemplate(`${ROOT}/templates/audio/soundboard.html`, { groups, presets, activeId });

    new Dialog({
      title: "ABOREA Audio",
      content: html,
      buttons: { close: { label: "Schließen" } },
      render: (jqHtml) => {
        const root = jqHtml[0] ?? jqHtml;

        // Button-Klicks
        root.addEventListener("click", async ev => {
          const btn = ev.target.closest("[data-audio-action]");
          if (!btn) return;
          const action   = btn.dataset.audioAction;
          const select   = root.querySelector("select[name='preset']");
          const presetId = select?.value;
          if (action === "start")    await this.playPreset(presetId);
          if (action === "oneshot")  await this.playOneShotFromPreset(presetId);
          if (action === "stop")     await this.stopAll();
          if (action === "next")     await this.playNextTrack();
          if (action === "prev")     await this.playPrevTrack();
          if (action === "playlist") await this.ensurePlaylists();
        });

        // Seek-Slider
        const seekSlider = root.querySelector(".aborea-seek-slider");
        if (seekSlider) {
          seekSlider.addEventListener("mousedown", () => {
            seekSlider.dataset.seeking = "1";
          });
          seekSlider.addEventListener("mouseup", () => {
            delete seekSlider.dataset.seeking;
            const sound = this.state.music;
            if (sound) {
              const dur = this._getSoundDuration(sound);
              if (dur > 0) this._seekSound(sound, (Number(seekSlider.value) / 1000) * dur);
            }
          });
          seekSlider.addEventListener("touchend", () => seekSlider.dispatchEvent(new Event("mouseup")));
        }

        // UI-Update-Schleife starten
        this._startUIUpdates(root);
      },
      close: () => {
        // Interval beim Schließen des Dialogs stoppen
        this._stopUIUpdates();
      }
    }).render(true);
  }

  // ── Playlists ────────────────────────────────────────────────────────────────

  static async ensurePlaylists() {
    if (!game.user?.isGM) return ui.notifications?.warn("Nur GM kann Playlists anlegen.");
    const presets = await this.loadPresets();
    const folderName = "ABOREA Audio";
    let folder = game.folders.find(f => f.type === "Playlist" && f.name === folderName);
    if (!folder) folder = await Folder.create({ name: folderName, type: "Playlist", color: "#7a5" });

    for (const preset of presets) {
      const playlistName = `ABOREA: ${preset.label}`;
      let playlist = game.playlists.find(p => p.name === playlistName);
      if (!playlist) {
        playlist = await Playlist.create({ name: playlistName, mode: CONST.PLAYLIST_MODES.DISABLED, folder: folder.id, fade: 2000 });
      }
      const existing = playlist.sounds.map(s => s.path);
      const entries = [
        ...(preset.music    || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "music",       repeat: true,  volume: 0.35 }); }),
        ...(preset.ambience || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "environment", repeat: true,  volume: 0.45 }); }),
        ...(preset.oneshots || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "interface",   repeat: false, volume: 0.7  }); })
      ].filter(s => !existing.includes(s.path));
      if (entries.length) await playlist.createEmbeddedDocuments("PlaylistSound", entries);
    }

    ui.notifications?.info("ABOREA Audio: Playlists angelegt/aktualisiert.");
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  static registerSettings() {
    game.settings.register("aborea-v7", "audioMusicVolume", {
      name: "ABOREA Audio Music Volume",
      scope: "client",
      config: true,
      type: Number,
      default: 0.35,
      range: { min: 0, max: 1, step: 0.05 }
    });
    game.settings.register("aborea-v7", "audioAmbienceVolume", {
      name: "ABOREA Audio Ambience Volume",
      scope: "client",
      config: true,
      type: Number,
      default: 0.45,
      range: { min: 0, max: 1, step: 0.05 }
    });
    game.settings.register("aborea-v7", "audioOneShotVolume", {
      name: "ABOREA Audio One-Shot Volume",
      scope: "client",
      config: true,
      type: Number,
      default: 0.7,
      range: { min: 0, max: 1, step: 0.05 }
    });
  }

  // ── Scene Control ─────────────────────────────────────────────────────────────

  static registerSceneControl() {
    Hooks.on("getSceneControlButtons", controls => {
      if (!game.user?.isGM) return;
      const entry = {
        name: "aborea-audio",
        title: "ABOREA Audio",
        icon: "fas fa-music",
        layer: "SoundsLayer",
        tools: [
          {
            name: "open",
            title: "Soundboard öffnen",
            icon: "fas fa-sliders-h",
            button: true,
            onClick: () => AboreaSoundboard.openDialog()
          },
          {
            name: "stop",
            title: "Alles stoppen",
            icon: "fas fa-stop",
            button: true,
            onClick: () => AboreaSoundboard.stopAll()
          }
        ]
      };
      // Foundry v12: controls is an Array; v13: controls is a plain object keyed by name
      if (Array.isArray(controls)) controls.push(entry);
      else if (controls && typeof controls === "object") controls[entry.name] = entry;
    });
  }
}
