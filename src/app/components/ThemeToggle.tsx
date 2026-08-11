"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import styles from "./ThemeToggle.module.css";

type Preference = "system" | "light" | "dark";

const ORDER: readonly Preference[] = ["system", "light", "dark"];

const COPY: Record<Preference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark"
};

function apply(preference: Preference) {
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    return;
  }
  document.documentElement.dataset.theme = preference;
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
}

function stored(): Preference {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function ThemeToggle() {
  /*
   * The real preference lives in localStorage, which the server cannot read, so
   * the control stays unlabelled until after mount rather than rendering a
   * value that hydration would have to correct.
   */
  const [preference, setPreference] = useState<Preference | null>(null);

  useEffect(() => {
    setPreference(stored());
  }, []);

  function cycle() {
    const current = preference ?? stored();
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    apply(next);
    setPreference(next);
  }

  return (
    <button className={styles.toggle} onClick={cycle} type="button">
      <span>Theme</span>
      <span className={styles.value}>{preference ? COPY[preference] : ""}</span>
    </button>
  );
}
