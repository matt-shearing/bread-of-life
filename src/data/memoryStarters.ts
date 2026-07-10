/**
 * A small curated starter set of classic memory verses — the kind Jesus wielded
 * from Deuteronomy. These are added on demand (the text snapshot is loaded from
 * the bundled BSB at add time) so a brand-new pool isn't empty.
 */
export interface StarterVerse {
  ho: string;
  chapter: number;
  verse: number;
}

export const MEMORY_STARTERS: StarterVerse[] = [
  { ho: "JHN", chapter: 3, verse: 16 }, // For God so loved the world…
  { ho: "PRO", chapter: 3, verse: 5 }, // Trust in the LORD with all your heart
  { ho: "PRO", chapter: 3, verse: 6 }, // …and He will make your paths straight
  { ho: "PHP", chapter: 4, verse: 13 }, // I can do all things through Christ
  { ho: "PHP", chapter: 4, verse: 6 }, // Be anxious for nothing
  { ho: "ROM", chapter: 8, verse: 28 }, // All things work together for good
  { ho: "ROM", chapter: 12, verse: 2 }, // Be transformed by the renewing of your mind
  { ho: "JOS", chapter: 1, verse: 9 }, // Be strong and courageous
  { ho: "ISA", chapter: 41, verse: 10 }, // Do not fear, for I am with you
  { ho: "JER", chapter: 29, verse: 11 }, // For I know the plans I have for you
  { ho: "PSA", chapter: 23, verse: 1 }, // The LORD is my shepherd
  { ho: "PSA", chapter: 119, verse: 11 }, // I have hidden Your word in my heart
  { ho: "MAT", chapter: 6, verse: 33 }, // Seek first the kingdom of God
  { ho: "GAL", chapter: 2, verse: 20 }, // I have been crucified with Christ
  { ho: "2TI", chapter: 3, verse: 16 }, // All Scripture is God-breathed
];
