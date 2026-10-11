import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * Review mode shows drafts and facts awaiting confirmation, highlighted.
 * It is on in `astro dev`, and in a build only when PUBLIC_REVIEW=true.
 * The production deploy builds without it, so nothing unconfirmed ships.
 */
export const REVIEW = import.meta.env.DEV || import.meta.env.PUBLIC_REVIEW === 'true';

/** A value that is published only once `confirmed` is true. */
export interface Fact<T = string> {
  value: T;
  confirmed: boolean;
  note?: string;
}

export const confirmed = <T>(value: T): Fact<T> => ({ value, confirmed: true });
export const pending = <T>(value: T, note?: string): Fact<T> => ({ value, confirmed: false, note });

/** Should this fact render in the current build? */
export const shows = (fact?: Fact<unknown>) => !!fact && (fact.confirmed || REVIEW);

export type Level = CollectionEntry<'projects'>['data']['level'];

/** The bodies of work, in display order. */
export const levels: { id: Level; label: string }[] = [
  { id: 'graduate', label: 'Graduate work' },
  { id: 'undergraduate', label: 'Undergraduate work' },
];

export const levelLabel = (level: Level) => levels.find((l) => l.id === level)!.label;

/** Published projects, plus drafts in review mode, in display order (by level, then order). */
export async function getProjects(): Promise<CollectionEntry<'projects'>[]> {
  const all = await getCollection('projects', ({ data }) => REVIEW || !data.draft);
  const rank = (level: Level) => levels.findIndex((l) => l.id === level);
  return all.sort((a, b) => rank(a.data.level) - rank(b.data.level) || a.data.order - b.data.order);
}

/** A project's 1-based position within its level. */
export const numberInLevel = (projects: CollectionEntry<'projects'>[], project: CollectionEntry<'projects'>) =>
  projects.filter((p) => p.data.level === project.data.level).indexOf(project) + 1;
