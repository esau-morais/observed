import * as stylex from '@stylexjs/stylex';
import { useEffect, useLayoutEffect, useState } from 'react';
import { fonts, geometry, media } from './constants.stylex';
import { darkColors, darkEffects } from './themes';
import { colors } from './tokens.stylex';

type Preference = 'system' | 'light' | 'dark';

const storageKey = 'observed-theme';
const darkQuery = '(prefers-color-scheme: dark)';

const styles = stylex.create({
  root: {
    backgroundColor: colors.canvas,
    color: colors.text,
    colorScheme: 'light',
  },
  dark: { colorScheme: 'dark' },
  control: {
    alignItems: 'center',
    color: colors.textSecondary,
    display: 'inline-flex',
    fontSize: '0.8125rem',
    gap: 8,
  },
  // The options name the setting, so the label is for assistive tech only.
  label: {
    clipPath: 'inset(50%)',
    height: 1,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
  select: {
    backgroundColor: colors.surface,
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    minHeight: geometry.target,
    paddingInline: 8,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
});

function stored(): Preference {
  try {
    const value = localStorage.getItem(storageKey);

    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function store(preference: Preference) {
  try {
    if (preference === 'system') {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, preference);
    }
  } catch {
    // The preference then lasts for this page only.
  }
}

// Applies the resolved theme to the document root so the whole page, its
// background and native controls follow it.
export function useTheme() {
  const [preference, setPreference] = useState(stored);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia(darkQuery).matches,
  );
  const dark = preference === 'dark' || (preference === 'system' && systemDark);

  useEffect(() => {
    const query = matchMedia(darkQuery);
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);

    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const { className = '' } = stylex.props(
      styles.root,
      dark && styles.dark,
      dark && darkColors,
      dark && darkEffects,
    );

    document.documentElement.className = className;
  }, [dark]);

  return {
    preference,
    choose: (next: Preference) => {
      setPreference(next);
      store(next);
    },
  };
}

export function ThemeControl({
  preference,
  choose,
}: ReturnType<typeof useTheme>) {
  return (
    <>
      <select
        value={preference}
        onChange={(event) => {
          const value = event.currentTarget.value;

          choose(value === 'light' || value === 'dark' ? value : 'system');
        }}
        {...stylex.props(styles.select)}
      >
        <option value="system">System theme</option>
        <option value="light">Light theme</option>
        <option value="dark">Dark theme</option>
      </select>
    </>
  );
}
