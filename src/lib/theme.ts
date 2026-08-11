export const THEME_STORAGE_KEY = "tripbuddy-theme";

/**
 * Applies a stored theme before first paint. Rendered as a blocking inline
 * script because reading localStorage in an effect would let the default theme
 * paint first and flash. Kept as a single expression so it stays cheap.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;
