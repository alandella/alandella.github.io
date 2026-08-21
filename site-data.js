/* site-data.js — reads the YAML content files and renders markdown.
   Loaded from each page's <helmet>; exposes window.SiteData. */
(function () {
	var MON = [
		"jan",
		"feb",
		"mar",
		"apr",
		"may",
		"jun",
		"jul",
		"aug",
		"sep",
		"oct",
		"nov",
		"dec",
	];
	var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

	/* ---------- YAML (subset: maps, sequences, flow lists, | and > blocks) ---------- */

	function stripComment(v) {
		var out = "",
			q = null;
		for (var i = 0; i < v.length; i++) {
			var c = v[i];
			if (q) {
				out += c;
				if (c === q) q = null;
				continue;
			}
			if (c === '"' || c === "'") {
				q = c;
				out += c;
				continue;
			}
			if (c === "#" && (i === 0 || /\s/.test(v[i - 1]))) break;
			out += c;
		}
		return out.trim();
	}

	function splitFlow(s) {
		var parts = [],
			cur = "",
			q = null,
			depth = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s[i];
			if (q) {
				cur += c;
				if (c === q) q = null;
				continue;
			}
			if (c === '"' || c === "'") {
				q = c;
				cur += c;
				continue;
			}
			if (c === "[") depth++;
			if (c === "]") depth--;
			if (c === "," && depth === 0) {
				parts.push(cur);
				cur = "";
				continue;
			}
			cur += c;
		}
		if (cur.trim()) parts.push(cur);
		return parts.map(function (p) {
			return p.trim();
		});
	}

	function scalar(raw) {
		var v = stripComment(raw);
		if (v === "" || v === "~" || v === "null") return null;
		if (v === "true" || v === "yes") return true;
		if (v === "false" || v === "no") return false;
		if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
		if (v.charAt(0) === "[" && v.charAt(v.length - 1) === "]") {
			var inner = v.slice(1, -1).trim();
			return inner ? splitFlow(inner).map(scalar) : [];
		}
		if (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"' && v.length > 1) {
			return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
		}
		if (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'" && v.length > 1) {
			return v.slice(1, -1).replace(/''/g, "'");
		}
		return v;
	}

	function parseYaml(text) {
		var lines = String(text).replace(/\r\n?/g, "\n").split("\n");
		var i = 0;

		function blank(l) {
			return /^\s*$/.test(l) || /^\s*#/.test(l);
		}
		function ind(l) {
			return l.match(/^ */)[0].length;
		}
		function skip() {
			while (i < lines.length && blank(lines[i])) i++;
		}
		function pad(n) {
			return new Array(n + 1).join(" ");
		}

		function node(at) {
			skip();
			if (i >= lines.length) return null;
			return /^\s*-(\s|$)/.test(lines[i]) ? seq(at) : map(at);
		}

		function seq(at) {
			var out = [];
			while (true) {
				skip();
				if (
					i >= lines.length ||
					ind(lines[i]) !== at ||
					!/^\s*-(\s|$)/.test(lines[i])
				)
					break;
				var rest = lines[i].slice(at + 1).replace(/^\s/, "");
				if (rest === "") {
					i++;
					out.push(node(at + 2));
					continue;
				}
				if (/^[^\s:][^:]*:(\s|$)/.test(rest)) {
					lines[i] = pad(at + 2) + rest;
					out.push(map(at + 2));
					continue;
				}
				i++;
				out.push(scalar(rest));
			}
			return out;
		}

		function map(at) {
			var out = {};
			while (true) {
				skip();
				if (i >= lines.length || ind(lines[i]) !== at) break;
				var m = lines[i].slice(at).match(/^([^\s:][^:]*):(.*)$/);
				if (!m) break;
				var key = m[1].trim(),
					rest = m[2].replace(/^\s+/, "");
				i++;
				if (/^[|>][-+]?$/.test(rest)) {
					var fold = rest.charAt(0) === ">",
						buf = [],
						base = null;
					while (i < lines.length) {
						if (/^\s*$/.test(lines[i])) {
							buf.push("");
							i++;
							continue;
						}
						if (ind(lines[i]) <= at) break;
						if (base === null) base = ind(lines[i]);
						buf.push(lines[i].slice(base));
						i++;
					}
					while (buf.length && buf[buf.length - 1] === "") buf.pop();
					out[key] = fold
						? buf.join(" ").replace(/[ \t\r\n]+/g, " ").trim()
						: buf.join("\n");
					continue;
				}
				if (rest === "") {
					skip();
					if (
						i < lines.length &&
						ind(lines[i]) === at &&
						/^\s*-(\s|$)/.test(lines[i])
					)
						out[key] = seq(at);
					else if (i < lines.length && ind(lines[i]) > at)
						out[key] = node(ind(lines[i]));
					else out[key] = null;
					continue;
				}
				out[key] = scalar(rest);
			}
			return out;
		}

		return node(0);
	}

	/* ---------- loading ---------- */

	var cache = {};
	function load(path) {
		if (!cache[path]) {
			cache[path] = fetch(path, { cache: "no-cache" })
				.then(function (r) {
					if (!r.ok) throw new Error(path + " — HTTP " + r.status);
					return r.text();
				})
				.then(parseYaml)
				.then(function (d) {
					return Array.isArray(d) ? d : d ? [d] : [];
				});
		}
		return cache[path];
	}

	/* Same fetch/parse, but keeps a top-level map as a map instead of wrapping
	   it in an array. Used for site.yml, which is a map rather than a list. */
	var mapCache = {};
	function loadMap(path) {
		if (!mapCache[path]) {
			mapCache[path] = fetch(path, { cache: "no-cache" })
				.then(function (r) {
					if (!r.ok) throw new Error(path + " — HTTP " + r.status);
					return r.text();
				})
				.then(parseYaml)
				.then(function (d) {
					return d && !Array.isArray(d) ? d : {};
				});
		}
		return mapCache[path];
	}

	/* ---------- site.yml + readiness ----------
	   Pages used to poll for window.SiteData with setTimeout(go, 60). They now
	   await ready(), which resolves once site.yml has been read and its theme
	   handed to SiteTheme. site.yml is optional: a missing file just means the
	   built-in defaults and the values already in the markup stay in effect. */

	var site = {};
	var readyPromise = null;

	function ready() {
		if (!readyPromise) {
			readyPromise = loadMap("site.yml")
				.catch(function () {
					return {};
				})
				.then(function (cfg) {
					site = cfg || {};
					if (window.SiteTheme) window.SiteTheme.applyTheme(site.theme);
					return site;
				});
		}
		return readyPromise;
	}

	function config() {
		return site;
	}

	function owner() {
		return (site.owner && site.owner.name) || "";
	}

	/* Dotted lookup with a fallback, so pages can ask for site.owner.role
	   without guarding every level: cfg("owner.role", "") */
	function cfgGet(path, fallback) {
		var cur = site;
		var parts = String(path || "").split(".");
		for (var i = 0; i < parts.length; i++) {
			if (cur == null || typeof cur !== "object") return fallback;
			cur = cur[parts[i]];
		}
		return cur == null || cur === "" ? fallback : cur;
	}

	/* ---------- small helpers ---------- */

	function slugify(s) {
		return String(s == null ? "" : s)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function fmtDate(v) {
		if (!v) return "";
		var s = String(v).trim(),
			m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
		if (!m) return s;
		var mo = MON[Number(m[2]) - 1] || "";
		return m[3] ? Number(m[3]) + " " + mo + " " + m[1] : mo + " " + m[1];
	}

	function yearOf(v) {
		var m = String(v == null ? "" : v).match(/(\d{4})/);
		return m ? Number(m[1]) : 0;
	}

	function readTime(body) {
		var words = String(body || "")
			.replace(/```[\s\S]*?```/g, " ")
			.trim()
			.split(/\s+/)
			.filter(Boolean).length;
		return Math.max(1, Math.round(words / 200));
	}

	// No generation: the BIB block only shows what you paste into publications.yml.
	function bibtex(p) {
		return p.bibtex ? String(p.bibtex).trim() : "";
	}

	function authorNodes(list, me) {
		var R = window.React,
			h = R.createElement;
		var arr = (Array.isArray(list) ? list : [list]).filter(Boolean);
		var needle = String(
			me || cfgGet("owner.surname", "Landella"),
		).toLowerCase(),
			out = [];
		arr.forEach(function (a, i) {
			var mine = String(a).toLowerCase().indexOf(needle) >= 0;
			out.push(
				mine
					? h("strong", { key: "a" + i, style: { fontWeight: 700 } }, a)
					: h("span", { key: "a" + i }, a),
			);
			if (i < arr.length - 1) out.push(h("span", { key: "s" + i }, ", "));
		});
		return out;
	}

	function splitRow(l) {
		return l
			.replace(/^\s*\|/, "")
			.replace(/\|\s*$/, "")
			.split("|")
			.map(function (s) {
				return s.trim();
			});
	}

	/* ---------- tags ----------
	   blog.html and projects.html both filter by tag; the logic below is the
	   shared half. tagsOf normalises the three shapes a tags: field can take
	   (list, single string, absent). */

	function tagsOf(entry) {
		if (!entry) return [];
		var raw = entry.tags;
		return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
	}

	function allTagsOf(list) {
		var out = [];
		(list || []).forEach(function (p) {
			tagsOf(p).forEach(function (x) {
				if (out.indexOf(x) < 0) out.push(x);
			});
		});
		return out;
	}

	/* Returns everything the two archive pages need to render their chip row
	   and filtered list, so neither has to re-implement it.
		 list   — the live (non-draft) entries
		 active — the tags currently selected, unvalidated
		 t      — resolved palette, for chip colours
		 noun   — ["post", "posts"] etc., for the count line */
	function tagFilter(list, active, t, noun, onToggle) {
		var all = allTagsOf(list);
		var sel = (active || []).filter(function (x) {
			return all.indexOf(x) >= 0;
		});
		var shown = sel.length
			? (list || []).filter(function (p) {
				return tagsOf(p).some(function (x) {
					return sel.indexOf(x) >= 0;
				});
			})
			: list || [];

		function count(n) {
			return n + " " + (n === 1 ? noun[0] : noun[1]);
		}

		return {
			tags: all,
			active: sel,
			shown: shown,
			filtering: sel.length > 0,
			chips: all.map(function (x) {
				var on = sel.indexOf(x) >= 0;
				return {
					label: x,
					toggle: function () {
						onToggle(x);
					},
					bg: on ? t.accent : "transparent",
					fg: on ? "#ffffff" : t.muted,
					border: on ? t.accent : t.divider,
				};
			}),
			countNote: sel.length
				? count(shown.length) + " tagged " + sel.join(" or ")
				: count((list || []).length),
		};
	}

	/* Toggle helper so pages don't each hand-roll the same setState reducer. */
	function toggleIn(arr, value) {
		return (arr || []).indexOf(value) >= 0
			? arr.filter(function (x) {
				return x !== value;
			})
			: (arr || []).concat([value]);
	}

	/* ---------- validation ----------
	   The YAML parser above is a subset and fails structurally rather than
	   loudly: a bad line just makes fields disappear. These checks turn the
	   common authoring mistakes into console warnings naming the file and the
	   entry, which is far easier to act on than a silently empty page. */

	function warn(file, msg) {
		if (window.console && console.warn) console.warn("[" + file + "] " + msg);
	}

	function label(entry, i) {
		if (!entry) return "entry " + (i + 1);
		return '"' + (entry.title || entry.slug || "entry " + (i + 1)) + '"';
	}

	/* required: field names every entry must carry.
	   needSlug: also check slugs are present and unique. */
	function validate(file, list, required, needSlug) {
		if (!Array.isArray(list)) {
			warn(file, "expected a list of entries.");
			return list;
		}
		var seen = {};
		list.forEach(function (entry, i) {
			if (!entry || typeof entry !== "object") {
				warn(file, label(entry, i) + " is not a map — check indentation.");
				return;
			}
			(required || []).forEach(function (f) {
				if (entry[f] == null || entry[f] === "") {
					warn(
						file,
						label(entry, i) + ' is missing required field "' + f + '".',
					);
				}
			});
			if (needSlug && entry.slug) {
				var s = String(entry.slug);
				if (seen[s]) {
					warn(
						file,
						'duplicate slug "' +
						s +
						'" — only the first entry is reachable at #' +
						s +
						".",
					);
				}
				seen[s] = true;
			}
		});
		return list;
	}

	/* ---------- markdown -> React nodes ---------- */

	function md(src, t) {
		var R = window.React,
			h = R.createElement,
			key = 0;
		var headings = [],
			notes = {},
			order = [],
			nodes = [];
		var raw = String(src || "")
			.replace(/\r\n?/g, "\n")
			.split("\n");
		var lines = [];
		raw.forEach(function (l) {
			var fm = l.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
			if (fm) notes[fm[1]] = fm[2];
			else lines.push(l);
		});

		function math(tex, display) {
			if (window.katex) {
				try {
					return h(display ? "div" : "span", {
						key: "k" + key++,
						style: display
							? { margin: "26px 0", overflowX: "auto", textAlign: "center" }
							: null,
						dangerouslySetInnerHTML: {
							__html: window.katex.renderToString(tex, {
								displayMode: !!display,
								throwOnError: false,
							}),
						},
					});
				} catch (e) {
					/* fall through */
				}
			}
			return h(
				display ? "div" : "span",
				{
					key: "k" + key++,
					style: {
						fontFamily: MONO,
						fontSize: display ? "15px" : "13.5px",
						color: t.accent,
						margin: display ? "26px 0" : 0,
						display: display ? "block" : "inline",
						textAlign: display ? "center" : "left",
					},
				},
				tex,
			);
		}

		function inline(s) {
			var out = [],
				buf = "",
				i = 0;
			function flush() {
				if (buf) {
					out.push(buf);
					buf = "";
				}
			}
			while (i < s.length) {
				var c = s.charAt(i),
					e;
				if (c === "\\") {
					buf += s.charAt(i + 1);
					i += 2;
					continue;
				}
				if (c === "$") {
					e = s.indexOf("$", i + 1);
					if (e > i + 1) {
						flush();
						out.push(math(s.slice(i + 1, e), false));
						i = e + 1;
						continue;
					}
				}
				if (c === "`") {
					e = s.indexOf("`", i + 1);
					if (e > i) {
						flush();
						out.push(
							h(
								"code",
								{
									key: key++,
									style: {
										fontFamily: MONO,
										fontSize: "0.87em",
										background: t.codeBg,
										padding: "2px 5px",
										borderRadius: "4px",
									},
								},
								s.slice(i + 1, e),
							),
						);
						i = e + 1;
						continue;
					}
				}
				if (c === "*" && s.charAt(i + 1) === "*") {
					e = s.indexOf("**", i + 2);
					if (e > 0) {
						flush();
						out.push(
							h(
								"strong",
								{ key: key++, style: { color: t.text } },
								inline(s.slice(i + 2, e)),
							),
						);
						i = e + 2;
						continue;
					}
				}
				if (c === "*" || c === "_") {
					e = s.indexOf(c, i + 1);
					if (e > i + 1) {
						flush();
						out.push(h("em", { key: key++ }, inline(s.slice(i + 1, e))));
						i = e + 1;
						continue;
					}
				}
				if (c === "[" && s.charAt(i + 1) === "^") {
					e = s.indexOf("]", i);
					if (e > 0) {
						var id = s.slice(i + 2, e);
						if (order.indexOf(id) < 0) order.push(id);
						flush();
						out.push(
							h(
								"sup",
								{ key: key++ },
								h(
									"a",
									{
										href: "#fn-" + id,
										id: "ref-" + id,
										style: {
											color: t.accent,
											textDecoration: "none",
											fontSize: "0.85em",
										},
									},
									String(order.indexOf(id) + 1),
								),
							),
						);
						i = e + 1;
						continue;
					}
				}
				if (c === "!" && s.charAt(i + 1) === "[") {
					var mi = s.indexOf("](", i),
						me2 = mi > 0 ? s.indexOf(")", mi) : -1;
					if (me2 > 0) {
						flush();
						var isrc = s.slice(mi + 2, me2);
						out.push(
							isrc
								? h("img", {
									key: key++,
									src: isrc,
									alt: s.slice(i + 2, mi),
									style: {
										maxWidth: "100%",
										borderRadius: "6px",
										verticalAlign: "middle",
									},
								})
								: h(
									"span",
									{
										key: key++,
										style: {
											fontFamily: MONO,
											fontSize: "11px",
											color: t.muted,
											border: "1px dashed " + t.dash,
											padding: "2px 6px",
											borderRadius: "3px",
										},
									},
									s.slice(i + 2, mi) || "image",
								),
						);
						i = me2 + 1;
						continue;
					}
				}
				if (c === "[") {
					var m1 = s.indexOf("](", i),
						m2 = m1 > 0 ? s.indexOf(")", m1) : -1;
					if (m2 > 0) {
						flush();
						var lhref = s.slice(m1 + 2, m2);
						// Same-page anchors stay put; anything else (external URL or a
						// file such as assets/cv.pdf) opens in a new tab.
						var lsame = /^(#|mailto:|tel:)/i.test(lhref);
						out.push(
							h(
								"a",
								{
									key: key++,
									href: lhref,
									target: lsame ? null : "_blank",
									rel: lsame ? null : "noopener noreferrer",
									style: { color: t.accent },
								},
								inline(s.slice(i + 1, m1)),
							),
						);
						i = m2 + 1;
						continue;
					}
				}
				buf += c;
				i++;
			}
			flush();
			return out;
		}

		function figure(cap, src) {
			var inner = src
				? h("img", {
					src: src,
					alt: cap,
					style: { display: "block", width: "100%", borderRadius: "8px" },
				})
				: h(
					"div",
					{
						style: {
							height: "260px",
							borderRadius: "8px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontFamily: MONO,
							fontSize: "11px",
							color: t.muted,
							background: t.codeBg,
							border: "1px dashed " + t.dash,
						},
					},
					"post image",
				);
			return h(
				"figure",
				{ key: key++, style: { margin: "32px 0" } },
				inner,
				cap
					? h(
						"figcaption",
						{ style: { marginTop: "8px", fontSize: "13px", color: t.muted } },
						inline(cap),
					)
					: null,
			);
		}

		var p = 0;
		function isBlank(l) {
			return /^\s*$/.test(l);
		}
		var SIZES = { 2: "24px", 3: "19px", 4: "17px" };

		while (p < lines.length) {
			var l = lines[p];
			if (isBlank(l)) {
				p++;
				continue;
			}

			if (/^```/.test(l)) {
				var code = [];
				p++;
				while (p < lines.length && !/^```/.test(lines[p]))
					code.push(lines[p++]);
				p++;
				nodes.push(
					h(
						"pre",
						{
							key: key++,
							style: {
								margin: "26px 0",
								padding: "16px 18px",
								borderRadius: "8px",
								overflowX: "auto",
								fontFamily: MONO,
								fontSize: "13.5px",
								lineHeight: 1.6,
								color: t.text,
								background: t.codeBg,
								border: "1px solid " + t.divider,
							},
						},
						h("code", null, code.join("\n")),
					),
				);
				continue;
			}

			var oneLineTex = l.match(/^\$\$([\s\S]+)\$\$\s*$/);
			if (oneLineTex) {
				nodes.push(math(oneLineTex[1].trim(), true));
				p++;
				continue;
			}

			if (/^\$\$\s*$/.test(l)) {
				var tex = [];
				p++;
				while (p < lines.length && !/^\$\$\s*$/.test(lines[p]))
					tex.push(lines[p++]);
				p++;
				nodes.push(math(tex.join("\n"), true));
				continue;
			}

			var hm = l.match(/^(#{2,4})\s+(.*)$/);
			if (hm) {
				var lvl = hm[1].length,
					txt = hm[2].trim(),
					id = slugify(txt);
				headings.push({
					id: id,
					text: txt,
					level: lvl,
					label: (lvl > 2 ? "· " : "") + txt,
				});
				nodes.push(
					h(
						"h" + lvl,
						{
							key: key++,
							id: id,
							style: {
								margin: lvl === 2 ? "38px 0 12px" : "28px 0 10px",
								fontSize: SIZES[lvl],
								fontWeight: 700,
								letterSpacing: "-0.03em",
								color: t.text,
								scrollMarginTop: "90px",
							},
						},
						inline(txt),
					),
				);
				p++;
				continue;
			}

			if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
				nodes.push(
					h("hr", {
						key: key++,
						style: {
							margin: "34px 0",
							border: 0,
							borderTop: "1px solid " + t.divider,
						},
					}),
				);
				p++;
				continue;
			}

			var im = l.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
			if (im) {
				nodes.push(figure(im[1], im[2]));
				p++;
				continue;
			}

			if (/^>\s?/.test(l)) {
				var q = [];
				while (p < lines.length && /^>\s?/.test(lines[p]))
					q.push(lines[p++].replace(/^>\s?/, ""));
				nodes.push(
					h(
						"blockquote",
						{
							key: key++,
							style: {
								margin: "32px 0",
								padding: "4px 0 4px 18px",
								fontSize: "19px",
								color: t.text,
								borderLeft: "3px solid " + t.accent,
							},
						},
						inline(q.join(" ")),
					),
				);
				continue;
			}

			if (
				/\|/.test(l) &&
				p + 1 < lines.length &&
				/^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[p + 1]) &&
				/\|/.test(lines[p + 1])
			) {
				var head = splitRow(l),
					rows = [];
				p += 2;
				while (p < lines.length && !isBlank(lines[p]) && /\|/.test(lines[p]))
					rows.push(splitRow(lines[p++]));
				nodes.push(
					h(
						"div",
						{ key: key++, style: { margin: "26px 0", overflowX: "auto" } },
						h(
							"table",
							{
								style: {
									borderCollapse: "collapse",
									width: "100%",
									fontSize: "15px",
								},
							},
							h(
								"thead",
								null,
								h(
									"tr",
									null,
									head.map(function (c, ci) {
										return h(
											"th",
											{
												key: ci,
												style: {
													textAlign: "left",
													padding: "9px 12px",
													fontWeight: 700,
													color: t.text,
													borderBottom: "2px solid " + t.divider,
												},
											},
											inline(c),
										);
									}),
								),
							),
							h(
								"tbody",
								null,
								rows.map(function (r, ri) {
									return h(
										"tr",
										{ key: ri },
										r.map(function (c, ci) {
											return h(
												"td",
												{
													key: ci,
													style: {
														padding: "9px 12px",
														color: t.muted,
														borderBottom: "1px solid " + t.divider,
														verticalAlign: "top",
													},
												},
												inline(c),
											);
										}),
									);
								}),
							),
						),
					),
				);
				continue;
			}

			if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
				var ordered = /^\s*\d+\.\s/.test(l),
					items = [];
				while (p < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[p])) {
					var it = lines[p].replace(/^\s*([-*]|\d+\.)\s+/, "");
					p++;
					while (
						p < lines.length &&
						!isBlank(lines[p]) &&
						!/^\s*([-*]|\d+\.)\s+/.test(lines[p]) &&
						!/^(#{2,4})\s|^>|^```|^\$\$/.test(lines[p])
					) {
						it += " " + lines[p].trim();
						p++;
					}
					items.push(it);
				}
				nodes.push(
					h(
						ordered ? "ol" : "ul",
						{
							key: key++,
							style: {
								margin: "0 0 22px",
								paddingLeft: "24px",
								color: t.muted,
								display: "flex",
								flexDirection: "column",
								gap: "7px",
							},
						},
						items.map(function (x, xi) {
							return h("li", { key: xi }, inline(x));
						}),
					),
				);
				continue;
			}

			var para = [];
			while (
				p < lines.length &&
				!isBlank(lines[p]) &&
				!/^(#{2,4})\s|^>|^```|^\$\$|^!\[|^\s*([-*]|\d+\.)\s+|^(-{3,}|\*{3,})\s*$/.test(
					lines[p],
				)
			)
				para.push(lines[p++]);
			if (!para.length) {
				p++;
				continue;
			}
			nodes.push(
				h(
					"p",
					{ key: key++, style: { margin: "0 0 22px", color: t.muted } },
					inline(para.join(" ")),
				),
			);
		}

		var footnotes = order.length
			? h(
				"ol",
				{
					style: {
						margin: 0,
						paddingLeft: "20px",
						color: t.muted,
						fontSize: "14.5px",
						display: "flex",
						flexDirection: "column",
						gap: "8px",
					},
				},
				order.map(function (id) {
					return h(
						"li",
						{ key: id, id: "fn-" + id, style: { scrollMarginTop: "90px" } },
						inline(notes[id] || ""),
						" ",
						h(
							"a",
							{
								href: "#ref-" + id,
								style: { color: t.accent, textDecoration: "none" },
							},
							"↩",
						),
					);
				}),
			)
			: null;

		return { nodes: nodes, headings: headings, footnotes: footnotes };
	}

	/* Render ONE line of markdown as inline nodes, with no wrapping <p>.
	   For short fields in site.yml (the bio paragraphs, a tagline) where you
	   want a [label](url) link but not a whole document. Returns an array of
	   React nodes, so a template can drop it straight into an element. */
	function mdInline(src, t) {
		var R = window.React, hh = R.createElement;
		var raw = String(src == null ? "" : src);
		// A blank line, or a line ending in a backslash, is an intentional
		// break; every other newline is YAML soft-wrapping and folds to a space.
		var chunks = raw.split(/\n[ \t]*\n|\\[ \t]*\n/);
		if (chunks.length > 1) {
			var parts = [];
			chunks.forEach(function (chunk, ci) {
				var piece = mdInline(chunk, t);
				if (piece == null) return;
				if (parts.length) parts.push(hh("br", { key: "br" + ci }));
				parts.push(hh("span", { key: "ln" + ci }, piece));
			});
			return parts.length ? parts : null;
		}
		var text = raw.replace(/[ \t\r]*\n[ \t\r]*/g, " ").trim();
		if (!text) return null;
		var out = md(text, t);
		var first = out.nodes && out.nodes[0];
		// md() wraps a lone line in a <p>; hand back just its children so the
		// caller's own element (and its styling) stays in control.
		if (first && first.props && first.type === "p") return first.props.children;
		return out.nodes;
	}

	/* ---------- toast + clipboard ----------
	   A single black bar at the bottom of the page, reused by every caller.
	   Kept here rather than per-page so publications.html and index.html
	   behave identically. */

	var toastEl = null;
	var toastTimer = null;

	function toast(msg, ms) {
		if (typeof document === "undefined") return;
		if (!toastEl) {
			toastEl = document.createElement("div");
			toastEl.setAttribute("role", "status");
			toastEl.setAttribute("aria-live", "polite");
			toastEl.style.cssText = [
				"position: fixed",
				"left: 50%",
				"bottom: 24px",
				"transform: translateX(-50%) translateY(8px)",
				"z-index: 9999",
				"max-width: calc(100vw - 32px)",
				"box-sizing: border-box",
				"padding: 11px 18px",
				"border-radius: 6px",
				"background: #000000",
				"color: #ffffff",
				"font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
				"font-size: 13px",
				"line-height: 1.4",
				"text-align: center",
				"box-shadow: 0 6px 24px rgba(0,0,0,0.35)",
				"opacity: 0",
				"pointer-events: none",
				"transition: opacity .18s ease, transform .18s ease"
			].join("; ");
			document.body.appendChild(toastEl);
		}
		toastEl.textContent = String(msg == null ? "" : msg);
		// force a reflow so the transition runs even on a rapid second click
		void toastEl.offsetWidth;
		toastEl.style.opacity = "1";
		toastEl.style.transform = "translateX(-50%) translateY(0)";
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			toastEl.style.opacity = "0";
			toastEl.style.transform = "translateX(-50%) translateY(8px)";
		}, ms == null ? 10000 : ms);
	}

	/* Copies text and shows a toast. Falls back to a hidden textarea when the
	   async clipboard API is unavailable (http:// origins, older browsers). */
	function copyText(text, okMsg, failMsg) {
		var value = String(text == null ? "" : text);
		var done = function () { toast(okMsg || "Copied to clipboard"); };
		var fail = function () { toast(failMsg || "Could not copy \u2014 " + value); };

		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(value).then(done, function () {
				if (!legacyCopy(value)) fail(); else done();
			});
			return;
		}
		if (legacyCopy(value)) done(); else fail();
	}

	function legacyCopy(value) {
		try {
			var ta = document.createElement("textarea");
			ta.value = value;
			ta.setAttribute("readonly", "");
			ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
			document.body.appendChild(ta);
			ta.select();
			ta.setSelectionRange(0, ta.value.length);
			var ok = document.execCommand("copy");
			document.body.removeChild(ta);
			return !!ok;
		} catch (e) {
			return false;
		}
	}

	window.SiteData = {
		toast: toast,
		copyText: copyText,
		parseYaml: parseYaml,
		load: load,
		loadMap: loadMap,
		slugify: slugify,
		fmtDate: fmtDate,
		yearOf: yearOf,
		readTime: readTime,
		bibtex: bibtex,
		authorNodes: authorNodes,
		md: md,
		mdInline: mdInline,
		ready: ready,
		config: config,
		cfg: cfgGet,
		owner: owner,
		tagsOf: tagsOf,
		allTagsOf: allTagsOf,
		tagFilter: tagFilter,
		toggleIn: toggleIn,
		validate: validate,
	};
})();
