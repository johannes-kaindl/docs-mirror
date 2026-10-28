import { PluginSettingTab, type App, type Plugin, type Setting, type SettingDefinitionItem } from "obsidian";
import { t, tn, type StringKey } from "../i18n/strings";
import { parseList, type DocsMirrorSettings, type RootCheck } from "../core/settings";
import { parsePatterns } from "../vendor/kit/ignore";
import { githubHelpUrls, helpSettingDefinition, type HelpSettingOptions } from "../vendor/kit-obsidian/help-setting";
import { renderSettingDefinitions } from "../vendor/kit-obsidian/settings_walker";

const MB = 1024 * 1024;

/** Was der Tab vom Plugin braucht: lesen, die Einstellungen ändern, die Wurzel setzen. Kein Lauf, nirgends. */
export interface SettingsHost {
  settings: DocsMirrorSettings;
  /** Die gerätelokale Wurzel; leer, solange dieses Gerät nichts eingerichtet hat. */
  root: string;
  updateSettings(patch: Partial<DocsMirrorSettings>): Promise<void>;
  /** Prüft und speichert die Wurzel (nur gerätelokal); ändert nichts, wenn sie nicht gültig ist. */
  setRoot(raw: string): RootCheck;
}

/** Doku-Index und Issues auf GitHub; `open` nur für Tests. */
export function helpOptions(open?: (url: string) => void): HelpSettingOptions {
  return {
    ...githubHelpUrls("docs-mirror"),
    texts: { name: t("settings.helpName"), desc: t("settings.helpDesc"), openDocs: t("settings.helpOpenDocs"), reportIssue: t("settings.helpReport") },
    ...(open ? { open } : {}),
  };
}

type Note = { text: string; kind: "error" | "warning" } | null;
type Outcome = { ok: true } | { ok: false; problem: StringKey };

interface FieldSpec {
  nameKey: StringKey;
  descKey: StringKey;
  multiline: boolean;
  /** Der Wert, wie das Feld ihn zeigt. */
  value: () => string;
  /** Prüft und speichert; schreibt nichts, wenn der Wert gleich geblieben ist. */
  commit: (text: string) => Outcome | Promise<Outcome>;
  /** Dauerhafter Hinweis unter dem Feld (z. B. ungültige Muster); nach jedem gültigen Speichern neu gerechnet. */
  note?: () => Note;
  /** Bei einem abgelehnten Wert springt das Feld auf den gespeicherten zurück (Wurzel: nein, der Pfad bleibt zum Korrigieren stehen). */
  revertOnError: boolean;
}

type ItemDef = { name?: string; desc?: string; control?: { type: string; key: string }; render?: (setting: Setting) => void };

const DOT = /^\./;

export class DocsMirrorSettingTab extends PluginSettingTab {
  private cleanupPrevious: () => void = () => {};

  /** `host` ist das Plugin selbst, auf den schmalen Vertrag verengt; so bleibt der Tab ohne Plugin-Klasse testbar. */
  constructor(app: App, plugin: Plugin, private readonly host: SettingsHost) {
    super(app, plugin);
  }

  /** Deklarativ (Obsidian ab 1.13 rendert das selbst); darunter zeichnet `display()` dieselbe Struktur mit dem Kit-Walker
   *  nach. Die Hilfe-Zeile ist immer das ERSTE Element (UI-STANDARD §8). */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const field = (spec: FieldSpec): ItemDef => ({ name: t(spec.nameKey), desc: t(spec.descKey), render: (s) => { this.renderField(s, spec); } });
    const defs: (ItemDef | ReturnType<typeof helpSettingDefinition>)[] = [
      helpSettingDefinition(helpOptions()),
      field(this.rootSpec()),
      field(this.listSpec("settings.patterns", "settings.patternsDesc", "patterns", true)),
      field(this.listSpec("settings.excludedNames", "settings.excludedNamesDesc", "excludedNames", false)),
      field(this.listSpec("settings.fileTypes", "settings.fileTypesDesc", "extensions", false)),
      field(this.megabytesSpec("settings.maxFile", "settings.maxFileDesc", "maxFileBytes")),
      field(this.megabytesSpec("settings.totalSize", "settings.totalSizeDesc", "maxTotalBytes")),
      field(this.thresholdSpec()),
      { name: t("settings.dotFolders"), desc: t("settings.dotFoldersDesc"), control: { type: "toggle", key: "includeDotFolders" } },
      { name: t("settings.syncOnStart"), desc: t("settings.syncOnStartDesc"), control: { type: "toggle", key: "syncOnStart" } },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  /** Host-Vertrag der deklarativen Controls (nativ ab 1.13 und im Kit-Walker). */
  getControlValue(key: string): unknown {
    return (this.host.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "includeDotFolders" || key === "syncOnStart") await this.host.updateSettings({ [key]: Boolean(value) });
  }

  display(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(this.containerEl, this.getSettingDefinitions(), this, this.app);
  }

  /** Text- und Textarea-Felder speichern bei `blur`, nicht je Tastendruck (Lehre aus Shadow Tree): ein Speichern setzt den
   *  Fingerabdruck der Einstellungen um, und je Zeichen würde das Feld unter dem Cursor neu gebaut. Name und Beschreibung
   *  setzt der Hatch selbst, weil ungemessen ist, ob der native 1.13-Host sie vor `render` setzt. Der Hinweis hängt NACH
   *  `setDesc` im Beschreibungsbereich, denn `setDesc` leert ihn. */
  private renderField(setting: Setting, spec: FieldSpec): void {
    setting.setName(t(spec.nameKey)).setDesc(t(spec.descKey));
    const noteEl = setting.descEl.createDiv({ cls: "dmr-field-note" });
    const showNote = (note: Note): void => {
      noteEl.setText(note?.text ?? "");
      noteEl.toggleClass("is-error", note?.kind === "error");
      noteEl.toggleClass("is-warning", note?.kind === "warning");
    };
    showNote(spec.note?.() ?? null);

    const wire = (comp: { getValue(): string; setValue(v: string): unknown; inputEl: HTMLInputElement | HTMLTextAreaElement }): void => {
      comp.setValue(spec.value());
      comp.inputEl.setAttribute("aria-label", t(spec.nameKey));
      comp.inputEl.addEventListener("blur", () => {
        void (async () => {
          const result = await spec.commit(comp.getValue());
          if (result.ok) {
            comp.setValue(spec.value());
            showNote(spec.note?.() ?? null);
          } else {
            if (spec.revertOnError) comp.setValue(spec.value());
            showNote({ text: t(result.problem), kind: "error" });
          }
        })();
      });
    };
    if (spec.multiline) {
      setting.addTextArea((ta) => { ta.inputEl.rows = 6; wire(ta); });
    } else {
      setting.addText((tx) => { wire(tx); });
    }
  }

  private rootSpec(): FieldSpec {
    const problems: Record<"empty" | "relative" | "tilde", StringKey> = { empty: "settings.rootEmpty", relative: "settings.rootRelative", tilde: "settings.rootTilde" };
    return {
      nameKey: "settings.root",
      descKey: "settings.rootDesc",
      multiline: false,
      revertOnError: false,
      value: () => this.host.root,
      note: () => (this.host.root === "/" ? { text: t("settings.rootSlash"), kind: "warning" } : null),
      commit: (text) => {
        if (text.trim() === this.host.root) return { ok: true };
        const r = this.host.setRoot(text);
        return r.ok ? { ok: true } : { ok: false, problem: problems[r.problem] };
      },
    };
  }

  private listSpec(nameKey: StringKey, descKey: StringKey, key: "patterns" | "excludedNames" | "extensions", multiline: boolean): FieldSpec {
    const clean = (items: string[]): string[] => (key === "extensions" ? [...new Set(items.map((e) => e.replace(DOT, "").toLowerCase()).filter((e) => e !== ""))] : items);
    return {
      nameKey, descKey, multiline,
      revertOnError: true,
      value: () => this.host.settings[key].join(multiline ? "\n" : ", "),
      note: () => {
        if (key !== "patterns") return null;
        const bad = parsePatterns(this.host.settings.patterns.join("\n")).invalid;
        return bad.length === 0 ? null : { text: tn("settings.patternsInvalid", bad.length, { list: bad.join(", ") }), kind: "warning" };
      },
      commit: async (text) => {
        const items = clean(parseList(text));
        if (items.length === 0) return { ok: false, problem: "settings.listEmpty" };
        if (JSON.stringify(items) !== JSON.stringify(this.host.settings[key])) await this.host.updateSettings({ [key]: items });
        return { ok: true };
      },
    };
  }

  private megabytesSpec(nameKey: StringKey, descKey: StringKey, key: "maxFileBytes" | "maxTotalBytes"): FieldSpec {
    return {
      nameKey, descKey,
      multiline: false,
      revertOnError: true,
      value: () => String(Math.round((this.host.settings[key] / MB) * 100) / 100),
      commit: async (text) => {
        const trimmed = text.trim().replace(",", ".");
        const mb = trimmed === "" ? NaN : Number(trimmed);
        if (!Number.isFinite(mb) || mb <= 0) return { ok: false, problem: "settings.numberInvalid" };
        const bytes = Math.round(mb * MB);
        if (bytes !== this.host.settings[key]) await this.host.updateSettings({ [key]: bytes });
        return { ok: true };
      },
    };
  }

  private thresholdSpec(): FieldSpec {
    return {
      nameKey: "settings.threshold",
      descKey: "settings.thresholdDesc",
      multiline: false,
      revertOnError: true,
      value: () => String(this.host.settings.deleteThresholdFiles),
      commit: async (text) => {
        const trimmed = text.trim();
        if (!/^\d+$/.test(trimmed)) return { ok: false, problem: "settings.numberInvalid" };
        const files = Number(trimmed);
        if (files !== this.host.settings.deleteThresholdFiles) await this.host.updateSettings({ deleteThresholdFiles: files });
        return { ok: true };
      },
    };
  }
}
