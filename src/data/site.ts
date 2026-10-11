import { confirmed, type Fact } from '../lib/review';

/**
 * Site-wide identity and contact details.
 * Use `confirmed(...)` for details Hussein has confirmed and `pending(...)` for
 * anything awaiting confirmation (highlighted in review builds, omitted in production).
 */
export const site = {
  name: 'Hussein Isaac',
  title: 'Hussein Isaac — Architecture Portfolio',
  description:
    'Architecture portfolio of Hussein Isaac — housing, technical lighting studies, drawings and design work.',
  discipline: 'Architecture · Documentation · Design',
  tagline: 'Designing thoughtful, buildable architecture for people, communities, and the future.',

  email: confirmed('boali9300@gmail.com'),
  linkedin: undefined as Fact | undefined,
  location: confirmed('Lexington, Kentucky'),
  languages: confirmed('English & Arabic'),
  education: confirmed('UK College of Design, 2016–2020'),
} as const;

/** Main navigation. Items are added as their pages are completed and approved. */
export const nav: { label: string; href: string }[] = [
  { label: 'Work', href: '/#work' },
  { label: 'Profile', href: '/#profile' },
  { label: 'Contact', href: '/#contact' },
];
