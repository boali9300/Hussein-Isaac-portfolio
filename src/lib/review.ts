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

/** Published projects, plus drafts in review mode, in display order. */
export async function getProjects(): Promise<CollectionEntry<'projects'>[]> {
  const all = await getCollection('projects', ({ data }) => REVIEW || !data.draft);
  return all.sort((a, b) => a.data.order - b.data.order);
}
