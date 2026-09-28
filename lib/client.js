window.__ModuleLoader__.load({
	id: "dsh-multimodal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
/**
 * dsh-multimodal — 客户端半边（雏形，手写，无需构建）。
 *  1. settings.section「多模态」设置页：读写 /dsh-multimodal/api/settings。
 *  2. tool.call.toolview 按工具名 `mm_image_demo` 注册卡片：用 owner 传入的 loadImage 显示持久图片。
 * 所有网络请求都是同源 fetch 到宿主，插件前端不直连外部资源（CSP）。
 */
var React = require("react");
var h = React.createElement;

var API = "/dsh-multimodal/api";

var STYLES = [
  ".mm-page{font-size:13px;line-height:1.6;padding:14px 16px;max-width:640px}",
  ".mm-page h3{margin:0 0 4px;font-size:14px}",
  ".mm-page .mm-sub{color:var(--theme-text-secondary,#888);font-size:12px;margin:0 0 14px}",
  ".mm-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}",
  ".mm-field label{font-weight:600;font-size:12px}",
  ".mm-field .mm-desc{color:var(--theme-text-secondary,#888);font-size:11px}",
  ".mm-input{background:var(--theme-input-bg,#111);color:var(--theme-text,#ddd);border:1px solid var(--theme-border,#333);border-radius:6px;padding:6px 8px;font-size:12px}",
  ".mm-row{display:flex;gap:8px;align-items:center;margin-top:6px}",
  ".mm-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px}",
  ".mm-btn:disabled{opacity:.45;cursor:not-allowed}",
  ".mm-msg{font-size:12px;color:var(--theme-text-secondary,#888)}",
  ".mm-msg.err{color:#e55}"
].join("\n");

var FIELDS = [
  { key: "imageProvider", label: "出图提供方", type: "select", options: ["demo", "openai-compatible"], desc: "demo 为本地演示图；openai-compatible 预留给真实生图接口（雏形阶段未接入）。" },
  { key: "imageEndpoint", label: "生图接口地址", type: "text", desc: "openai-compatible 时使用。" },
  { key: "imageModel", label: "生图模型", type: "text", desc: "雏形阶段未接入。" },
  { key: "defaultSize", label: "演示图默认边长（px）", type: "number", min: 64, max: 1024, desc: "mm_image_demo 未指定 size 时使用，64–1024。" }
];

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fetchJson(path, init) {
  return fetch(API + path, Object.assign({ headers: { "content-type": "application/json" } }, init || {}))
    .then(function (r) { return r.json(); });
}

function renderSettingsPage() {
  var page = el("div", "mm-page");
  var style = document.createElement("style");
  style.textContent = STYLES;
  page.append(style, el("h3", undefined, "多模态（dsh-multimodal）"));
  var sub = el("p", "mm-sub", "正在读取设置…");
  page.append(sub);

  var inputs = {};
  FIELDS.forEach(function (f) {
    var wrap = el("div", "mm-field");
    var label = el("label", undefined, f.label);
    var input;
    if (f.type === "select") {
      input = el("select", "mm-input");
      f.options.forEach(function (o) {
        var opt = el("option", undefined, o);
        opt.value = o;
        input.append(opt);
      });
    } else {
      input = el("input", "mm-input");
      input.type = f.type;
      if (f.min !== undefined) input.min = String(f.min);
      if (f.max !== undefined) input.max = String(f.max);
    }
    inputs[f.key] = input;
    wrap.append(label, input, el("span", "mm-desc", f.desc));
    page.append(wrap);
  });

  var row = el("div", "mm-row");
  var save = el("button", "mm-btn", "保存");
  var msg = el("span", "mm-msg");
  row.append(save, msg);
  page.append(row);

  function fill(value) {
    FIELDS.forEach(function (f) {
      var v = value && value[f.key];
      inputs[f.key].value = v === undefined || v === null ? "" : String(v);
    });
  }
  function say(text, isErr) {
    msg.textContent = text;
    msg.className = isErr ? "mm-msg err" : "mm-msg";
  }

  fetchJson("/settings").then(function (d) {
    if (!d || !d.ok) throw new Error((d && d.error) || "读取失败");
    fill(d.value);
    sub.textContent = d.persisted ? "设置保存在 DSH 设置服务里，修改后立即生效。" : "当前没有设置服务，修改只在本次运行内有效。";
  }).catch(function (e) {
    sub.textContent = "无法连接插件宿主接口：" + e.message;
    sub.className = "mm-msg err";
  });

  save.addEventListener("click", function () {
    var patch = {};
    FIELDS.forEach(function (f) {
      var raw = inputs[f.key].value;
      patch[f.key] = f.type === "number" ? Number(raw) : raw;
    });
    save.disabled = true;
    say("保存中…");
    fetchJson("/settings", { method: "POST", body: JSON.stringify(patch) }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "保存失败");
      fill(d.value);
      say("已保存");
    }).catch(function (e) {
      say(e.message, true);
    }).finally(function () {
      save.disabled = false;
    });
  });

  return page;
}

// ── mm_image_demo 工具卡片 ──
function imageRefs(block) {
  var content = block && Array.isArray(block.content) ? block.content : [];
  return content.filter(function (b) { return b && b.type === "image" && b.attachment; })
    .map(function (b) { return b.attachment; });
}
function blockText(block) {
  var content = block && Array.isArray(block.content) ? block.content : [];
  return content.filter(function (b) { return b && b.type === "text"; })
    .map(function (b) { return b.text; }).join("\n");
}

function DemoImage(props) {
  var st = React.useState(null);
  var url = st[0];
  var setUrl = st[1];
  var es = React.useState(false);
  var failed = es[0];
  var setFailed = es[1];
  React.useEffect(function () {
    var alive = true;
    if (!props.loadImage) return undefined;
    props.loadImage(props.attachment).then(function (u) { if (alive) setUrl(u); }, function () { if (alive) setFailed(true); });
    return function () { alive = false; };
  }, [props.attachment, props.loadImage]);
  if (failed) return h("div", { style: { fontSize: 12, color: "#e55" } }, "图片加载失败");
  if (!url) return h("div", { style: { width: 160, height: 160, borderRadius: 8, background: "rgba(127,127,127,.15)" } });
  return h("img", {
    src: url,
    alt: props.attachment.name || "mm_image_demo",
    style: { maxWidth: 320, maxHeight: 320, borderRadius: 8, display: "block" }
  });
}

function ImageDemoRow(props) {
  var block = props.block;
  var refs = imageRefs(block);
  var text = blockText(block);
  var args = (block && (block.args || block.input)) || {};
  return h("div", {
    style: { border: "1px solid var(--theme-border,#333)", borderRadius: 10, padding: "10px 12px", margin: "4px 0", fontSize: 12 }
  },
    h("div", { style: { fontWeight: 600, marginBottom: 6 } }, "🖼 mm_image_demo" + (args.prompt ? " · " + args.prompt : "")),
    refs.length > 0
      ? h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, refs.map(function (ref, i) {
          return h(DemoImage, { key: ref.attachmentId || i, attachment: ref, loadImage: props.loadImage });
        }))
      : h("div", { style: { color: "var(--theme-text-secondary,#888)" } }, text || "生成中…"),
    refs.length > 0 && text ? h("div", { style: { marginTop: 6, color: "var(--theme-text-secondary,#888)" } }, text) : null
  );
}

var inject = ["slots"];
function apply(ctx) {
  ctx.effect(function () {
    return ctx.slots.inject("settings.section", function () {
      return ctx.slots.register({
        name: "settings.section",
        id: "dsh-multimodal",
        order: 60,
        label: function () { return "多模态"; },
        component: function () { return { render: renderSettingsPage }; }
      });
    });
  }, "dsh-multimodal: settings page");

  ctx.slots.inject("tool.call.toolview", function () {
    return ctx.slots.register({ name: "tool.call.toolview", key: "mm_image_demo" }, ImageDemoRow);
  });
}

exports.inject = inject;
exports.apply = apply;
exports.name = "dsh-multimodal-client";
		return module.exports;
	}
});
