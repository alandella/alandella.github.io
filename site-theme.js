/* site-theme.js — the one place the colour palette and the light/dark/system
   theme engine live. Loaded from each page's <helmet>, before site-data.js.
   Exposes window.SiteTheme.

   Every page used to carry its own copy of PALETTES plus the matchMedia /
   localStorage plumbing; they now all defer to this file. To recolour the
   site, edit site.yml (theme: block) — or, failing that, DEFAULTS below. */
(function () {
	var ORDER = ["system", "light", "dark"];
	var KEY = "singlesite-theme";

	/* Fallback palette. site.yml (theme:) overrides any of these keys; anything
		 it omits keeps the value below, so a partial theme block is fine. */
	var DEFAULTS = {
		light: {
			bg: "#e8e9ee",
			navBg: "rgba(232,233,238,0.5)",
			text: "#161A26",
			muted: "#6C7288",
			accent: "#2E5BD8",
			divider: "#D6DAE4",
			dash: "#C3C8D6",
			cardBg: "#FBFBFD",
			codeBg: "#DFE3EC",
			footerBg: "#161A26",
			footerText: "#D6DAE4",
			footerLink: "#FBFBFD",
		},
		dark: {
			bg: "#161A26",
			navBg: "rgba(22,26,38,0.5)",
			text: "#D6DAE4",
			muted: "#8A90A6",
			accent: "#6C8FF0",
			divider: "#2C3242",
			dash: "#3C4356",
			cardBg: "#1E2331",
			codeBg: "#232936",
			footerBg: "#D6DAE4",
			footerText: "#161A26",
			footerLink: "#161A26",
		},
	};

	/* Live palette. Mutated in place by applyTheme so pages holding a reference
		 to PALETTES.light / PALETTES.dark see the YAML values once they land. */
	var PALETTES = {
		light: Object.assign({}, DEFAULTS.light),
		dark: Object.assign({}, DEFAULTS.dark),
	};

	function applyTheme(theme) {
		if (!theme) return;
		["light", "dark"].forEach(function (mode) {
			var over = theme[mode];
			if (!over || typeof over !== "object") return;
			Object.keys(over).forEach(function (k) {
				if (over[k]) PALETTES[mode][k] = String(over[k]);
			});
		});
	}

	function readSetting() {
		var saved = "system";
		try {
			saved = localStorage.getItem(KEY) || "system";
		} catch (e) { }
		return ORDER.indexOf(saved) >= 0 ? saved : "system";
	}

	function writeSetting(v) {
		try {
			localStorage.setItem(KEY, v);
		} catch (e) { }
	}

	function nextSetting(cur) {
		return ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
	}

	function iconFor(setting) {
		if (setting === "system") return "fa-solid fa-circle-half-stroke";
		return setting === "light" ? "fa-solid fa-sun" : "fa-solid fa-moon";
	}

	function titleFor(setting) {
		return "Theme: " + setting + " — click to switch";
	}

	/* ---------- the per-page mixin ----------
		 Each page's Component calls these three from its own lifecycle hooks,
		 which keeps this framework-agnostic (no inheritance games with DCLogic). */

	/* Wires up matchMedia + restores the saved setting. Returns the initial
		 state patch the caller should merge into its own setState. */
	function start(cmp) {
		cmp.__mq = window.matchMedia("(prefers-color-scheme: dark)");
		cmp.__onMq = function () {
			cmp.setState({ systemDark: cmp.__mq.matches });
		};
		cmp.__mq.addEventListener("change", cmp.__onMq);
		return { setting: readSetting(), systemDark: cmp.__mq.matches };
	}

	function stop(cmp) {
		if (cmp.__mq) cmp.__mq.removeEventListener("change", cmp.__onMq);
	}

	function resolve(state) {
		if (state.setting === "system") return state.systemDark ? "dark" : "light";
		return state.setting;
	}

	/* Mirrors the resolved theme onto <html>/<body>. pageTitle is optional and
		 only used by the single-entry pages (post.html / project.html). */
	function sync(state, pageTitle) {
		var mode = resolve(state);
		document.documentElement.setAttribute("data-theme-setting", state.setting);
		document.documentElement.setAttribute("data-theme", mode);
		document.body.style.background = PALETTES[mode].bg;
		document.body.style.color = PALETTES[mode].text;
		if (pageTitle) {
			var who = (window.SiteData && window.SiteData.owner()) || "";
			// Append the owner only once it's known, so the title never ends in a
			// dangling separator while site.yml is still in flight.
			document.title = who ? pageTitle + " — " + who : pageTitle;
		}
	}

	/* The {{ t }}, {{ themeIcon }}, {{ themeTitle }}, {{ cycleTheme }} bundle
		 every page's renderVals() spreads into its base object. */
	function vals(cmp) {
		var state = cmp.state;
		return {
			t: PALETTES[resolve(state)],
			themeIcon: iconFor(state.setting),
			themeTitle: titleFor(state.setting),
			cycleTheme: function () {
				var next = nextSetting(cmp.state.setting);
				writeSetting(next);
				cmp.setState({ setting: next });
			},
		};
	}

	window.SiteTheme = {
		PALETTES: PALETTES,
		ORDER: ORDER,
		KEY: KEY,
		applyTheme: applyTheme,
		resolve: resolve,
		sync: sync,
		start: start,
		stop: stop,
		vals: vals,
	};
})();
