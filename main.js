"use strict";

const { MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl } = require("obsidian");
const { ViewPlugin, Decoration, layer, RectangleMarker } = require("@codemirror/view");
const { StateEffect, RangeSetBuilder } = require("@codemirror/state");

const DEFAULT_SETTINGS = {
	lineBar: true, // bar over the current line, independent of focus/typewriter
	barShowWhen: "always", // "always" | "focus" | "typewriter" | "either" (focus or typewriter)
	barBand: true, // tinted background band
	barEdge: false, // accent marker on the left edge
	barUnderline: false, // rule under the line
	barCoverage: "row", // "row" (only the cursor's visual row) | "line" (all wrapped rows)
	barColor: "", // empty = theme accent colour
	barStrength: 12, // band tint strength, %
	darkTheme: true, // switch to the theme's dark variant while focusing
	fadeOpacity: 0.08, // opacity of faded interface (sidebars, ribbon, tabs, status bar)
	dimMode: "paragraph", // "off" | "line" | "paragraph"
	dimOpacity: 0.3, // opacity of text outside the active line/paragraph
	typewriterPosition: 50, // % from the top of the editor where the active line sits
	typewriterWithFocus: true, // ribbon / Esc toggle typewriter together with focus
	showWordCount: true, // floating session word counter during focus mode
	showSubtitle: true, // show the "subtitle" frontmatter property under the note title
	subtitleInEditing: false, // also show it in Live Preview / Source mode (always shown in reading mode)
};

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

function countWords(text) {
	const matches = text.match(WORD_RE);
	return matches ? matches.length : 0;
}

// Net words added by a transaction: recount the whole lines touched by the change,
// before and after, so edits in the middle of a word are counted correctly.
function wordDelta(tr) {
	let fromA = Infinity, toA = -1, fromB = Infinity, toB = -1;
	tr.changes.iterChangedRanges((fa, ta, fb, tb) => {
		fromA = Math.min(fromA, fa);
		toA = Math.max(toA, ta);
		fromB = Math.min(fromB, fb);
		toB = Math.max(toB, tb);
	});
	if (toA < 0) return 0;

	const oldDoc = tr.startState.doc;
	const newDoc = tr.state.doc;
	const before = oldDoc.sliceString(oldDoc.lineAt(fromA).from, oldDoc.lineAt(toA).to);
	const after = newDoc.sliceString(newDoc.lineAt(fromB).from, newDoc.lineAt(toB).to);
	return countWords(after) - countWords(before);
}

// Obsidian loads a file into an editor by replacing the whole document; that isn't writing.
function isFileLoad(tr) {
	if (tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo")) {
		return false;
	}
	let whole = false;
	tr.changes.iterChangedRanges((fa, ta) => {
		if (fa === 0 && ta === tr.startState.doc.length) whole = true;
	});
	return whole;
}

function formatDuration(ms) {
	const mins = Math.round(ms / 60000);
	if (mins < 1) return "under a minute";
	if (mins < 60) return `${mins} min`;
	return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function formatWords(n) {
	const sign = n > 0 ? "+" : n < 0 ? "−" : "";
	const abs = Math.abs(n);
	return `${sign}${abs.toLocaleString()} ${abs === 1 ? "word" : "words"}`;
}

// Dispatched to every editor to force a redraw after state/settings change.
const refreshEffect = StateEffect.define();

const activeLineDeco = Decoration.line({ class: "wm-active" });

function activeLines(state, mode) {
	const doc = state.doc;
	const line = doc.lineAt(state.selection.main.head);
	if (mode !== "paragraph") return [line.number, line.number];

	const isBlank = (n) => doc.line(n).text.trim() === "";
	if (isBlank(line.number)) return [line.number, line.number];

	let from = line.number;
	let to = line.number;
	while (from > 1 && !isBlank(from - 1)) from--;
	while (to < doc.lines && !isBlank(to + 1)) to++;
	return [from, to];
}

function buildEditorExtension(plugin) {
	return ViewPlugin.fromClass(
		class {
			constructor(view) {
				this.decorations = this.build(view);
			}

			update(u) {
				// Only the focused editor counts, so a second pane showing the same note
				// doesn't count the synced change twice.
				if (plugin.focus && u.docChanged && u.view.hasFocus) {
					let delta = 0;
					for (const tr of u.transactions) {
						if (tr.docChanged && !isFileLoad(tr)) delta += wordDelta(tr);
					}
					if (delta !== 0) plugin.addSessionWords(delta);
				}

				const forced = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
				if (u.docChanged || u.selectionSet || forced) {
					this.decorations = this.build(u.view);
				}

				// Re-centre while typing or moving with the keyboard, but not on mouse clicks,
				// so clicking somewhere doesn't yank the text out from under the pointer.
				const pointer = u.transactions.some((tr) => tr.isUserEvent("select.pointer"));
				if (plugin.typewriter && !pointer && (u.docChanged || u.selectionSet || forced)) {
					this.centre(u.view);
				}
			}

			build(view) {
				const mode = plugin.settings.dimMode;
				if (!plugin.focus || mode === "off") return Decoration.none;

				const builder = new RangeSetBuilder();
				const [from, to] = activeLines(view.state, mode);
				for (let n = from; n <= to; n++) {
					builder.add(view.state.doc.line(n).from, view.state.doc.line(n).from, activeLineDeco);
				}
				return builder.finish();
			}

			centre(view) {
				view.requestMeasure({
					key: "writing-mode-typewriter",
					read: (v) => {
						const coords = v.coordsAtPos(v.state.selection.main.head);
						if (!coords) return null;
						const rect = v.scrollDOM.getBoundingClientRect();
						const target = rect.top + (rect.height * plugin.settings.typewriterPosition) / 100;
						return (coords.top + coords.bottom) / 2 - target;
					},
					write: (delta, v) => {
						if (delta !== null && Math.abs(delta) > 1) v.scrollDOM.scrollTop += delta;
					},
				});
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

// Drawn as a CodeMirror layer behind the text rather than by styling .cm-line,
// so it never changes line layout (lists, quotes, headings keep their indents).
function buildLineBarLayer(plugin) {
	const BAR_PADDING = 10; // px the bar extends past the text column on each side

	return layer({
		above: false,
		class: "wm-bar-layer",
		update: (u) =>
			u.docChanged ||
			u.selectionSet ||
			u.viewportChanged ||
			u.geometryChanged ||
			u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect))),
		markers: (view) => {
			const s = plugin.settings;
			if (!s.lineBar || !(s.barBand || s.barEdge || s.barUnderline)) return [];
			const visible = {
				always: true,
				focus: plugin.focus,
				typewriter: plugin.typewriter,
				either: plugin.focus || plugin.typewriter,
			}[s.barShowWhen];
			if (!visible) return [];

			const sel = view.state.selection.main;
			let top, bottom;
			if (s.barCoverage === "row") {
				const c = view.coordsAtPos(sel.head, sel.assoc < 0 ? -1 : 1);
				if (!c) return [];
				// The character box is shorter than the row; pad it out to a full line height.
				const height = Math.max(c.bottom - c.top, view.defaultLineHeight);
				const mid = (c.top + c.bottom) / 2;
				top = mid - height / 2;
				bottom = mid + height / 2;
			} else {
				const block = view.lineBlockAt(sel.head);
				top = block.top + view.documentTop;
				bottom = block.bottom + view.documentTop;
			}

			const content = view.contentDOM.getBoundingClientRect();
			const scroller = view.scrollDOM.getBoundingClientRect();
			const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
			const baseTop = scroller.top - view.scrollDOM.scrollTop;

			return [
				new RectangleMarker(
					"wm-bar-mark",
					content.left - BAR_PADDING - baseLeft,
					top - baseTop,
					content.width + BAR_PADDING * 2,
					bottom - top
				),
			];
		},
	});
}

// Resolve the theme's accent colour to hex so the colour picker can show it.
function accentHex() {
	const probe = document.body.createDiv();
	probe.style.color = "var(--color-accent)";
	const rgb = getComputedStyle(probe).color.match(/\d+/g) || ["129", "161", "193"];
	probe.remove();
	return "#" + rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

// ---- Auto-update from GitHub ----
const UPDATE_REPO = "VeryRandomness/obsidian-writing-mode";
const UPDATE_BRANCH = "main";

function isNewerVersion(remote, local) {
	const a = remote.split(".").map((n) => parseInt(n, 10) || 0);
	const b = local.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
}

async function fetchRepoText(ref, file) {
	const url = `https://raw.githubusercontent.com/${UPDATE_REPO}/${ref}/${file}?t=${Date.now()}`;
	return (await requestUrl({ url, headers: { "Cache-Control": "no-cache" } })).text;
}

// Resolve the branch to an exact commit so a stale CDN copy of "main" is never read.
async function latestRepoRef() {
	try {
		const res = await requestUrl({
			url: `https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`,
			headers: { Accept: "application/vnd.github+json", "Cache-Control": "no-cache" },
		});
		if (res.json && res.json.sha) return res.json.sha;
	} catch (e) {
		console.warn("Writing mode auto-update: commit lookup failed, falling back to branch", e);
	}
	return UPDATE_BRANCH;
}

async function checkForUpdate(plugin, manual) {
	const { manifest, app } = plugin;
	try {
		const ref = await latestRepoRef();
		const remoteManifest = await fetchRepoText(ref, "manifest.json");
		const version = JSON.parse(remoteManifest).version;
		if (!isNewerVersion(version, manifest.version)) {
			if (manual) new Notice(`${manifest.name} is up to date (version ${manifest.version}).`);
			return;
		}
		const mainJs = await fetchRepoText(ref, "main.js");
		if (!mainJs.trim()) throw new Error("downloaded main.js is empty");
		let css = null;
		try { css = await fetchRepoText(ref, "styles.css"); } catch { /* optional */ }

		const adapter = app.vault.adapter;
		await adapter.write(`${manifest.dir}/main.js`, mainJs);
		await adapter.write(`${manifest.dir}/manifest.json`, remoteManifest);
		if (css !== null) await adapter.write(`${manifest.dir}/styles.css`, css);

		new Notice(`${manifest.name} updated to ${version}. Reloading…`);
		const plugins = app.plugins;
		setTimeout(async () => {
			await plugins.disablePlugin(manifest.id);
			await plugins.enablePlugin(manifest.id);
		}, 500);
	} catch (e) {
		console.error("Writing mode auto-update:", e);
		if (manual) new Notice(`Update check failed: ${e.message}`);
	}
}

class WritingModePlugin extends Plugin {
	async onload() {
		this.addCommand({ id: "check-for-update", name: "Check for update now", callback: () => checkForUpdate(this, true) });
		this.app.workspace.onLayoutReady(() => checkForUpdate(this, false));
		const data = (await this.loadData()) || {};
		// Migrate the old "only during focus mode" toggle.
		if ("barFocusOnly" in data) {
			data.barShowWhen ??= data.barFocusOnly ? "either" : "always";
			delete data.barFocusOnly;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.focus = false;
		this.typewriter = false;
		this.swappedTheme = false;
		this.sessionWords = 0;
		this.sessionStart = 0;

		this.counterEl = document.body.createDiv({ cls: "wm-word-counter" });
		this.register(() => this.counterEl.remove());

		this.registerEditorExtension(buildEditorExtension(this));
		if (layer && RectangleMarker) this.registerEditorExtension(buildLineBarLayer(this));

		this.ribbonEl = this.addRibbonIcon("pen-line", "Toggle writing mode", () => {
			this.setWritingMode(!this.focus);
		});

		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("wm-status");
		this.focusStatusEl = this.statusEl.createSpan({ cls: "wm-status-toggle", text: "Focus" });
		this.typewriterStatusEl = this.statusEl.createSpan({ cls: "wm-status-toggle", text: "Typewriter" });
		this.focusStatusEl.setAttr("aria-label", "Toggle focus mode");
		this.typewriterStatusEl.setAttr("aria-label", "Toggle typewriter mode");
		this.registerDomEvent(this.focusStatusEl, "click", () => this.setFocus(!this.focus));
		this.registerDomEvent(this.typewriterStatusEl, "click", () => this.setTypewriter(!this.typewriter));

		this.addCommand({
			id: "toggle-writing-mode",
			name: "Toggle writing mode",
			callback: () => this.setWritingMode(!this.focus),
		});
		this.addCommand({
			id: "toggle-focus-mode",
			name: "Toggle focus mode",
			callback: () => this.setFocus(!this.focus),
		});
		this.addCommand({
			id: "toggle-typewriter-mode",
			name: "Toggle typewriter mode",
			callback: () => this.setTypewriter(!this.typewriter),
		});
		this.addCommand({
			id: "toggle-line-bar",
			name: "Toggle current line bar",
			callback: async () => {
				this.settings.lineBar = !this.settings.lineBar;
				await this.saveSettings();
			},
		});

		this.registerDomEvent(document, "keydown", (evt) => {
			if (evt.key !== "Escape" || !this.focus) return;
			// Leave Esc alone while it has another job to do (closing a modal, menu or popup).
			if (document.querySelector(".modal-container, .menu, .suggestion-container, .popover")) return;
			this.setWritingMode(false);
		});

		const refreshSubtitles = () => this.refreshSubtitles();
		this.registerEvent(this.app.workspace.on("layout-change", refreshSubtitles));
		this.registerEvent(this.app.workspace.on("active-leaf-change", refreshSubtitles));
		this.registerEvent(this.app.workspace.on("file-open", () => setTimeout(refreshSubtitles, 50)));
		this.registerEvent(this.app.metadataCache.on("changed", refreshSubtitles));

		this.addSettingTab(new WritingModeSettingTab(this.app, this));
		this.applyCssVars();
		this.refresh();
		this.app.workspace.onLayoutReady(refreshSubtitles);
	}

	onunload() {
		this.unloading = true;
		document.querySelectorAll(".wm-subtitle").forEach((el) => el.remove());
		this.setFocus(false);
		this.setTypewriter(false);
		document.body.style.removeProperty("--wm-fade-opacity");
		document.body.style.removeProperty("--wm-dim-opacity");
		document.body.style.removeProperty("--wm-tw-position");
		document.body.style.removeProperty("--wm-bar-color");
		document.body.style.removeProperty("--wm-bar-strength");
		document.body.removeClasses(["wm-dim", "wm-show-count", "wm-bar-band", "wm-bar-edge", "wm-bar-underline"]);
	}

	setWritingMode(on) {
		this.setFocus(on);
		if (this.settings.typewriterWithFocus) this.setTypewriter(on);
	}

	setFocus(on) {
		if (on === this.focus) return;
		this.focus = on;
		const body = document.body;

		if (on) {
			this.sessionWords = 0;
			this.sessionStart = Date.now();
			this.updateCounter();
		} else if (!this.unloading) {
			const duration = formatDuration(Date.now() - this.sessionStart);
			new Notice(`Focus session: ${formatWords(this.sessionWords)} in ${duration}`, 8000);
		}
		body.toggleClass("wm-focus", on);

		if (on && this.settings.darkTheme && body.hasClass("theme-light")) {
			body.removeClass("theme-light");
			body.addClass("theme-dark");
			this.swappedTheme = true;
		} else if (!on && this.swappedTheme) {
			body.removeClass("theme-dark");
			body.addClass("theme-light");
			this.swappedTheme = false;
		}
		this.refresh();
	}

	addSessionWords(delta) {
		this.sessionWords += delta;
		this.updateCounter();
	}

	updateCounter() {
		this.counterEl.setText(formatWords(this.sessionWords));
	}

	setTypewriter(on) {
		this.typewriter = on;
		document.body.toggleClass("wm-typewriter", on);
		this.refresh();
	}

	applyCssVars() {
		const style = document.body.style;
		style.setProperty("--wm-fade-opacity", String(this.settings.fadeOpacity));
		style.setProperty("--wm-dim-opacity", String(this.settings.dimOpacity));
		style.setProperty("--wm-tw-position", String(this.settings.typewriterPosition / 100));
		style.setProperty("--wm-bar-color", this.settings.barColor || "var(--color-accent)");
		style.setProperty("--wm-bar-strength", `${this.settings.barStrength}%`);
	}

	refreshSubtitles() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) this.renderSubtitle(leaf.view);
		});
	}

	renderSubtitle(view) {
		view.containerEl.querySelectorAll(".wm-subtitle").forEach((el) => el.remove());
		if (!this.settings.showSubtitle || !view.file) return;

		const reading = view.getMode() === "preview";
		if (!reading && !this.settings.subtitleInEditing) return;

		const root = view.containerEl.querySelector(reading ? ".markdown-reading-view" : ".markdown-source-view");
		if (!root) return;

		let sub = this.app.metadataCache.getFileCache(view.file)?.frontmatter?.subtitle;
		if (Array.isArray(sub)) sub = sub.join(", ");
		if (sub === undefined || sub === null || String(sub).trim() === "") return;

		const el = createDiv({ cls: "wm-subtitle", text: String(sub) });
		const title = root.querySelector(".inline-title");
		if (title) {
			title.insertAdjacentElement("afterend", el);
		} else {
			root.querySelector(reading ? ".markdown-preview-sizer" : ".cm-sizer")?.prepend(el);
		}
	}

	refresh() {
		this.refreshSubtitles();
		document.body.toggleClass("wm-dim", this.settings.dimMode !== "off");
		document.body.toggleClass("wm-show-count", this.settings.showWordCount);
		document.body.toggleClass("wm-bar-band", this.settings.barBand);
		document.body.toggleClass("wm-bar-edge", this.settings.barEdge);
		document.body.toggleClass("wm-bar-underline", this.settings.barUnderline);
		this.ribbonEl?.toggleClass("is-active", this.focus);
		this.focusStatusEl?.toggleClass("is-active", this.focus);
		this.typewriterStatusEl?.toggleClass("is-active", this.typewriter);

		this.app.workspace.iterateAllLeaves((leaf) => {
			const cm = leaf.view?.editor?.cm;
			if (cm) cm.dispatch({ effects: refreshEffect.of(null) });
		});
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyCssVars();
		this.refresh();
	}
}

class WritingModeSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Focus mode").setHeading();

		new Setting(containerEl)
			.setName("Switch to dark theme")
			.setDesc("Use your theme's dark variant while focus mode is on, and switch back afterwards.")
			.addToggle((t) =>
				t.setValue(s.darkTheme).onChange(async (v) => {
					s.darkTheme = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Faded interface opacity")
			.setDesc("How visible the sidebars, ribbon, tabs and status bar are until you hover over them.")
			.addSlider((sl) =>
				sl
					.setLimits(0, 0.5, 0.02)
					.setValue(s.fadeOpacity)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.fadeOpacity = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dim surrounding text")
			.setDesc("Keep only the current line or paragraph bright.")
			.addDropdown((d) =>
				d
					.addOptions({ off: "Off", line: "Current line", paragraph: "Current paragraph" })
					.setValue(s.dimMode)
					.onChange(async (v) => {
						s.dimMode = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dimmed text opacity")
			.addSlider((sl) =>
				sl
					.setLimits(0.05, 0.8, 0.05)
					.setValue(s.dimOpacity)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.dimOpacity = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show session word count")
			.setDesc("Net words written since focus mode started, shown in the corner of the editor.")
			.addToggle((t) =>
				t.setValue(s.showWordCount).onChange(async (v) => {
					s.showWordCount = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Current line bar").setHeading();

		const toggle = (name, desc, key) =>
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(s[key]).onChange(async (v) => {
						s[key] = v;
						await this.plugin.saveSettings();
					})
				);

		toggle("Show current line bar", "Mark the line you're writing on.", "lineBar");
		new Setting(containerEl)
			.setName("Show bar")
			.setDesc("When the bar appears.")
			.addDropdown((d) =>
				d
					.addOptions({
						always: "Always",
						focus: "Only in focus mode",
						typewriter: "Only in typewriter mode",
						either: "In focus or typewriter mode",
					})
					.setValue(s.barShowWhen)
					.onChange(async (v) => {
						s.barShowWhen = v;
						await this.plugin.saveSettings();
					})
			);
		toggle("Highlight band", "A tinted strip behind the line.", "barBand");
		toggle("Edge marker", "A solid bar on the left edge of the line.", "barEdge");
		toggle("Underline", "A rule under the line, like a typewriter's guide.", "barUnderline");

		new Setting(containerEl)
			.setName("Coverage")
			.setDesc("Cover only the row of text the cursor is on, or the whole paragraph it wraps across.")
			.addDropdown((d) =>
				d
					.addOptions({ row: "Current row of text", line: "Whole paragraph" })
					.setValue(s.barCoverage)
					.onChange(async (v) => {
						s.barCoverage = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Colour")
			.setDesc(s.barColor ? "Custom colour." : "Following your theme's accent colour.")
			.addColorPicker((c) =>
				c.setValue(s.barColor || accentHex()).onChange(async (v) => {
					s.barColor = v;
					await this.plugin.saveSettings();
				})
			)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Use theme accent colour")
					.onClick(async () => {
						s.barColor = "";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Band strength")
			.setDesc("How strongly the highlight band is tinted.")
			.addSlider((sl) =>
				sl
					.setLimits(4, 40, 2)
					.setValue(s.barStrength)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.barStrength = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Subtitle").setHeading();

		new Setting(containerEl)
			.setName("Show subtitle")
			.setDesc('Show the "subtitle" frontmatter property under the note title in reading mode.')
			.addToggle((t) =>
				t.setValue(s.showSubtitle).onChange(async (v) => {
					s.showSubtitle = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Show in editing mode")
			.setDesc("Also show the subtitle in Live Preview and Source mode.")
			.addToggle((t) =>
				t.setValue(s.subtitleInEditing).onChange(async (v) => {
					s.subtitleInEditing = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Typewriter mode").setHeading();

		new Setting(containerEl)
			.setName("Line position")
			.setDesc("Where the line you're typing on stays, as a percentage of the editor's height from the top.")
			.addSlider((sl) =>
				sl
					.setLimits(10, 90, 5)
					.setValue(s.typewriterPosition)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.typewriterPosition = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Turn on with focus mode")
			.setDesc("The ribbon icon and Esc toggle typewriter mode together with focus mode.")
			.addToggle((t) =>
				t.setValue(s.typewriterWithFocus).onChange(async (v) => {
					s.typewriterWithFocus = v;
					await this.plugin.saveSettings();
				})
			);
	}
}

module.exports = WritingModePlugin;
