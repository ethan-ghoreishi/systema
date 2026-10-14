import { describe, it, expect } from 'vitest';
import { splitJournal, assignPhotos } from '../../src/lib/journal';
import { photoRef } from '../../src/lib/photos';

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
