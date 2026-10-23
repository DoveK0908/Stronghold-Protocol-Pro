// 一个皮肤/干员 Spine 模型的本地预览页：看面部（贴图 alpha 是否正常）、骨骼名、动画表。
//
//   /dev/spine-face.html?id=char_291_aglina_summer_5&skel=char_291_aglina_summer_5.display.skel
//   /dev/spine-face.html?id=char_4087_ines&base=/assets/spine/op/char_4087_ines
//
// 参数：id 目录名；base 模型目录（默认 /assets/skins/<id>）；atlas / skel 直接覆盖文件名（默认 front/<id>.atlas、
// front/<id>.skel —— 注意 tools/prepare-operator-skins.mjs 与 tools/local-extract/skinspines.py 会把带编辑器根的
// 客户端骨架写成 <id>.display.skel，皮肤里两种命名都有）；zoom 放大倍数；shift 垂直位移。
//
// 载入必须用 `data: { spineAtlasFile }`：pixi-spine 只认这个键，写成 `atlas` 它会自己去推导 <skel>.display.atlas
// 而报 "Something went terribly wrong loading a spine .atlas file"。
const q = new URLSearchParams(location.search);
const id = q.get('id') || 'char_249_mlyss_ambienceSynesthesia_6';
const base = q.get('base') || `/assets/skins/${id}`;
const app = new PIXI.Application({ background: 0xffffff, width: 900, height: 900, antialias: true });
document.body.appendChild(app.view);
// skel / atlas 既可以给完整路径，也可以只给文件名（那就当它是 front/ 下的文件名，方便切 .display.skel）。
const file = (v, fallback) => (!v ? fallback : v.includes('/') ? v : `${base}/front/${v}`);
const atlasUrl = file(q.get('atlas'), `${base}/front/${id}.atlas`);
const skelUrl = file(q.get('skel'), `${base}/front/${id}.skel`);
const data = await PIXI.Assets.load({ src: skelUrl, data: { spineAtlasFile: atlasUrl } });
const spine = new PIXI.spine.Spine(data.spineData);
const box = spine.getLocalBounds();
// 900/box.height 已经给了全身；zoom 是在此之上的倍数（0.5 = 半身，2 = 局部特写）。
const s = (900 / box.height) * (Number(q.get('zoom')) || 1);
spine.scale.set(s);
spine.x = 450 - (box.x + box.width / 2) * s;
spine.y = 900 - (box.y + box.height) * s + (Number(q.get('shift')) || 0);
app.stage.addChild(spine);
const anim = (spine.spineData.animations || []).find((a) => /Idle|idle|Relax/i.test(a.name)) || spine.spineData.animations[0];
if (anim) spine.state.setAnimation(0, anim.name, true);
app.ticker.add(() => spine.update(app.ticker.deltaMS / 1000));
globalThis.__ANIMS__ = (spine.spineData.animations || []).map((a) => a.name);
globalThis.__BONES__ = (spine.spineData.bones || []).map((b) => b.name);
globalThis.__READY__ = true;
