import { describe, it, expect } from 'vitest';
import { splitJournal, assignPhotos } from '../../src/lib/journal';
import { photoRef, photoRefs } from '../../src/lib/photos';

describe('splitJournal', () => {
  it('splits markdown and photo placeholders', () => {
    const text = '# Debrief\n\nIntro para.\n\n[photo: P-3f9a1c]\n\nMore text.';
    const segs = splitJournal(text);
    expect(segs.map((s) => s.kind)).toEqual(['md', 'photo', 'md']);
    expect(segs[1]).toEqual({ kind: 'photo', ref: 'P-3f9a1c' });
  });

  it('tolerates a leading ! and odd spacing/case', () => {
    expect(splitJournal('![PHOTO:  Harbour baths ]')).toEqual([
      { kind: 'photo', ref: 'Harbour baths' },
    ]);
  });

  it('returns one md segment when there are no placeholders', () => {
    expect(splitJournal('just text')).toEqual([{ kind: 'md', text: 'just text' }]);
  });
});

describe('assignPhotos', () => {
  const photo = (id: string, createdAt: number, place: string, takenAt?: number) => ({
    id,
    createdAt,
    takenAt,
    place,
  });
  const placeOf = (p: { place: string }) => p.place;

  it('places photos by stable reference, even with two stops of the same name', () => {
    const a = photo('aaaaaa11-0000-4000-8000-000000000000', 1, 'Cathedral');
    const b = photo('bbbbbb22-0000-4000-8000-000000000000', 2, 'Cathedral');
    const segs = splitJournal(`[photo: ${photoRef(b.id)}]\ntext\n[photo: ${photoRef(a.id)}]`);
    const { photoForSegment, leftovers } = assignPhotos(segs, [a, b], placeOf);
    expect(photoForSegment.filter(Boolean).map((p) => p!.id)).toEqual([b.id, a.id]);
    expect(leftovers).toEqual([]);
  });

  it('still resolves older name placeholders in capture order', () => {
    const segs = splitJournal('a\n[photo: X]\nb\n[photo: X]\nc\n[photo: Y]');
    const photos = [
      photo('x2', 2, 'X'),
      photo('x1', 9, 'X', 1),
      photo('x3', 3, 'X'),
      photo('z1', 1, 'Z'),
    ];
    const { photoForSegment, leftovers } = assignPhotos(segs, photos, placeOf);
    expect(photoForSegment.filter(Boolean).map((p) => p!.id)).toEqual(['x1', 'x2']); // taken order
    expect(leftovers.map((p) => p.id)).toEqual(['z1', 'x3']);
  });

  it('a reference that matches nothing resolves to null', () => {
    const segs = splitJournal('[photo: P-000000]\n[photo: Unknown]');
    const { photoForSegment } = assignPhotos(segs, [photo('c1', 1, 'Carlsberg')], placeOf);
    expect(photoForSegment).toEqual([null, null]);
  });
});

describe('photo references of a whole set', () => {
  // Six hex digits is 16 million values: two of a few hundred photos share one
  // now and then, and a repeated reference puts one photo where the other
  // belongs. Only the clashing pair gets a longer reference.
  const clashA = 'abcdef12-0000-4000-8000-000000000001';
  const clashB = 'abcdef34-0000-4000-8000-000000000002';
  const alone = '99887766-0000-4000-8000-000000000003';

  it('keeps six digits where they are unique and lengthens only a clash', () => {
    const refs = photoRefs([clashA, clashB, alone]);
    expect(refs.get(alone)).toBe('P-998877'); // unchanged, as it has always been
    expect(refs.get(clashA)).toBe('P-abcdef120000');
    expect(refs.get(clashB)).toBe('P-abcdef340000');
    expect(new Set(refs.values()).size).toBe(3);
    expect(photoRefs([alone]).get(alone)).toBe(photoRef(alone));
  });

  it('resolves a longer reference, and a six-digit one written before', () => {
    const a = { id: clashA, createdAt: 1, place: 'A' };
    const b = { id: clashB, createdAt: 2, place: 'B' };
    const place = (p: { place: string }) => p.place;
    const long = photoRefs([clashA, clashB]).get(clashA)!;
    expect(
      assignPhotos(splitJournal(`[photo: ${long}]`), [a, b], place).photoForSegment[0]!.id,
    ).toBe(clashA);
    // A journal written when the set was small still finds a photo by six.
    expect(
      assignPhotos(splitJournal(`[photo: ${photoRef(clashA)}]`), [a, b], place).photoForSegment[0]!
        .id,
    ).toBe(clashA);
  });
});
