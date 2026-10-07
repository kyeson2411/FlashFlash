// Main navigation.
// Set `enabled: true` only when the page actually exists. Disabled entries are
// kept here so the planned structure is visible, but they are not shown to students.

export type NavLink = { href: string; label: string; enabled: boolean };

export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", enabled: true },
  { href: "/generate", label: "Generate", enabled: true },
  { href: "/decks", label: "My Decks", enabled: true },
  { href: "/study", label: "Study", enabled: false }, // studying is always from a specific deck
];

export const ENABLED_NAV_LINKS = NAV_LINKS.filter((link) => link.enabled);
