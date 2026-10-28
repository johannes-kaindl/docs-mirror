import { Plugin, getLanguage } from "obsidian";
import { pickLang, setLang } from "./vendor/kit/i18n";

function rawLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class DocsMirrorPlugin extends Plugin {
  async onload(): Promise<void> {
    // Sprache vor allen Texten setzen (EN ist Fallback); Funktionen folgen mit den Tasks 3 ff.
    setLang(pickLang(rawLanguage()));
  }

  onunload(): void {
    // Gerüst: nichts zu räumen.
  }
}
