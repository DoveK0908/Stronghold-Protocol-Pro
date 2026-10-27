// 主界面音乐库 (public/js/lobbyMusicLibrary.js): the 23 packaged lobby tracks of selena 0.4.1 (`factionMusicCatalog.js`
// entries with `home: true`), copied here byte-for-byte as `assets/audio/bgm/lobby/faction_<hash>.ogg`. A pick is one of
// these ids (`lib_<hash>`); audio.js lobbyTrackOf resolves it, and the 大厅音乐 card lists them (ui/lobbyMusicPanel.js).
// Regenerate with tools/import-lobby-music.mjs after adding files; the ids are the file hashes, so they stay stable.
// 曲名是官方曲目名（专有名词），按原样显示，故逐行标 `// i18n-ignore`——和干员名走 dn() 是同一个理由：译名会认错歌。

export const LOBBY_LIBRARY = Object.freeze([
  { id: "lib_549a631e13d6e6c52a97", title: "旅途前方", url: "/public/assets/audio/bgm/lobby/faction_549a631e13d6e6c52a97.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_9aa20a09c014cc9a0758", title: "Proof of being alive", url: "/public/assets/audio/bgm/lobby/faction_9aa20a09c014cc9a0758.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_f6f75553c0ed51470b33", title: "凡常恩典", url: "/public/assets/audio/bgm/lobby/faction_f6f75553c0ed51470b33.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_2c4a4c9ef8c9c00ab10e", title: "直到大地变成一颗酸橙", url: "/public/assets/audio/bgm/lobby/faction_2c4a4c9ef8c9c00ab10e.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_3ba06437627adf32a8f5", title: "用不上的雨刷", url: "/public/assets/audio/bgm/lobby/faction_3ba06437627adf32a8f5.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_08c14a7aadc0dcbd9ccf", title: "大柏墟", url: "/public/assets/audio/bgm/lobby/faction_08c14a7aadc0dcbd9ccf.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_c3dabea34a44d8946106", title: "生命流", url: "/public/assets/audio/bgm/lobby/faction_c3dabea34a44d8946106.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_95cf3b52884961d3e694", title: "示岁", url: "/public/assets/audio/bgm/lobby/faction_95cf3b52884961d3e694.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_e1a2689b296158f67e7d", title: "酸橙色信笺", url: "/public/assets/audio/bgm/lobby/faction_e1a2689b296158f67e7d.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_62f152d388229bef0d03", title: "Everything's Alright", url: "/public/assets/audio/bgm/lobby/faction_62f152d388229bef0d03.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_ea8a892aec46c4ec0233", title: "Protocol", url: "/public/assets/audio/bgm/lobby/faction_ea8a892aec46c4ec0233.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_3f42789dbad9d0c06e29", title: "赴大荒", url: "/public/assets/audio/bgm/lobby/faction_3f42789dbad9d0c06e29.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_ecb023a937557932ddd3", title: "启航", url: "/public/assets/audio/bgm/lobby/faction_ecb023a937557932ddd3.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_39ddecb6840d7e659330", title: "秉心", url: "/public/assets/audio/bgm/lobby/faction_39ddecb6840d7e659330.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_bf7e5d9e42285dba70ea", title: "Neo-vector", url: "/public/assets/audio/bgm/lobby/faction_bf7e5d9e42285dba70ea.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_d91b7f2fef0aa0ae6b75", title: "栖所架构", url: "/public/assets/audio/bgm/lobby/faction_d91b7f2fef0aa0ae6b75.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_818d7919799f895393cc", title: "走过漫漫时空", url: "/public/assets/audio/bgm/lobby/faction_818d7919799f895393cc.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_3dad0bd5d7c2e62139b0", title: "Дом", url: "/public/assets/audio/bgm/lobby/faction_3dad0bd5d7c2e62139b0.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_7974fdf94a25290ee9df", title: "Theoretical Simulation", url: "/public/assets/audio/bgm/lobby/faction_7974fdf94a25290ee9df.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_86375e68963374acb05b", title: "INFECTED", url: "/public/assets/audio/bgm/lobby/faction_86375e68963374acb05b.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_e24d69b3287873c59436", title: "塞壬唱片-MSR-immutable遗尘漫步ost remix（DavidClarkson remix）", url: "/public/assets/audio/bgm/lobby/faction_e24d69b3287873c59436.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_79c559b00a5e50f30425", title: "Misty Memory (Night Version)", url: "/public/assets/audio/bgm/lobby/faction_79c559b00a5e50f30425.ogg" }, // i18n-ignore 官方曲名，原样显示
  { id: "lib_80a1030cdfe24c72e451_a1181a2014ad", title: "卫戍协议: 规程", url: "/public/assets/audio/bgm/lobby/faction_80a1030cdfe24c72e451_a1181a2014ad.ogg" }, // i18n-ignore 官方曲名，原样显示
]);

/** @param {string} id @returns {{id:string,title:string,url:string}|null} */
export const lobbyTrack = (id) => LOBBY_LIBRARY.find((x) => x.id === id) || null;
