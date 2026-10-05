// Player heads: the platform's avatar for a human (an SVG), loaded once and cached. A bot has none (its helmet shows an initial).

export function createAvatars(ow) {
  const cache = new Map();
  return {
    /** The head image for a player id, or null until it has loaded (or outside the platform). */
    get(id) {
      let entry = cache.get(id);
      if (!entry) {
        entry = { img: null };
        cache.set(id, entry);
        try {
          const asking = ow?.player?.avatarUrl ? ow.player.avatarUrl(id, 'head') : null;
          if (asking && typeof asking.then === 'function') {
            asking
              .then((url) => {
                if (typeof url !== 'string' || !url) return;
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  entry.ok = true;
                };
                img.src = url;
                entry.img = img;
              })
              .catch(() => {});
          }
        } catch {
          // no avatar: the initial is drawn
        }
      }
      return entry.img && entry.img.complete !== false && (entry.ok || entry.img.naturalWidth > 0) ? entry.img : null;
    },
  };
}
