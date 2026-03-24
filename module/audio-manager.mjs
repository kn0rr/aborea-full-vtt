const ROOT = `systems/aborea-v7`;
const PRESETS_PATH = `${ROOT}/data/audio-presets.json`;

export class AboreaSoundboard {
  static state = {
    ambience: null,
    music: null,
    presetId: null
  };

  static async loadPresets() {
    if (this._presets) return this._presets;
    const response = await foundry.utils.fetchWithTimeout(PRESETS_PATH);
    const json = await response.json();
    this._presets = json.presets || [];
    return this._presets;
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
    return await AudioHelper.play({ src, loop, volume, fade, autoplay: true }, true);
  }

  static async stopSound(sound, fade = 500) {
    if (!sound) return;
    try { await sound.fade(0, { duration: fade }); } catch (e) {}
    try { sound.stop(); } catch (e) {}
  }

  static async stopAll(fade = 500) {
    await this.stopSound(this.state.ambience, fade);
    await this.stopSound(this.state.music, fade);
    this.state.ambience = null;
    this.state.music = null;
    this.state.presetId = null;
  }

  static async playPreset(presetId) {
    const presets = await this.loadPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return ui.notifications?.error(`ABOREA Audio: Unbekanntes Preset ${presetId}`);
    await this.stopAll(700);
    const ambienceSrc = this.randomFrom(preset.ambience);
    const musicSrc = this.randomFrom(preset.music);
    const ambienceVol = Number(game.settings.get("aborea-v7", "audioAmbienceVolume") ?? 0.45);
    const musicVol = Number(game.settings.get("aborea-v7", "audioMusicVolume") ?? 0.35);
    this.state.ambience = await this.playFile(ambienceSrc, { loop: true, volume: ambienceVol, fade: 800 });
    this.state.music = await this.playFile(musicSrc, { loop: true, volume: musicVol, fade: 1200 });
    this.state.presetId = preset.id;
    ChatMessage.create({ content: `<strong>ABOREA Audio</strong><br>Szene gestartet: ${preset.label}` });
  }

  static async playOneShotFromPreset(presetId) {
    const presets = await this.loadPresets();
    const preset = presets.find(p => p.id === presetId || p.id === this.state.presetId);
    if (!preset) return ui.notifications?.warn("ABOREA Audio: Kein Preset aktiv.");
    const src = this.randomFrom(preset.oneshots);
    const vol = Number(game.settings.get("aborea-v7", "audioOneShotVolume") ?? 0.7);
    if (!src) return ui.notifications?.warn("ABOREA Audio: Für dieses Preset ist kein One-Shot definiert.");
    await this.playFile(src, { loop: false, volume: vol, fade: 0 });
  }

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
        ...(preset.music || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "music", repeat: true, volume: 0.35 }); }),
        ...(preset.ambience || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "environment", repeat: true, volume: 0.45 }); }),
        ...(preset.oneshots || []).map(path => { path = this.normalizePath(path); return ({ name: foundry.utils.getRoute(path).split('/').pop(), path, channel: "interface", repeat: false, volume: 0.7 }); })
      ].filter(s => !existing.includes(s.path));
      if (entries.length) await playlist.createEmbeddedDocuments("PlaylistSound", entries);
    }

    ui.notifications?.info("ABOREA Audio: Playlists angelegt/aktualisiert.");
  }

  static async openDialog() {
    const presets = await this.loadPresets();
    const activeId = this.state.presetId || presets[0]?.id || "";
    const html = await renderTemplate(`${ROOT}/templates/audio/soundboard.html`, { presets, activeId });
    new Dialog({
      title: "ABOREA Audio",
      content: html,
      buttons: {
        close: { label: "Schließen" }
      },
      render: (html) => {
        html.on("click", "[data-audio-action]", async ev => {
          const btn = ev.currentTarget;
          const action = btn.dataset.audioAction;
          const select = html.find("select[name='preset']")[0];
          const presetId = select?.value;
          if (action === "start") await this.playPreset(presetId);
          if (action === "oneshot") await this.playOneShotFromPreset(presetId);
          if (action === "stop") await this.stopAll();
          if (action === "playlist") await this.ensurePlaylists();
        });
      }
    }).render(true);
  }

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

  static registerSceneControl() {
    Hooks.on("getSceneControlButtons", controls => {
      if (!game.user?.isGM) return;
      controls.push({
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
      });
    });
  }
}
