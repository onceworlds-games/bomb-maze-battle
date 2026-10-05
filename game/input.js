// Keyboard and the platform's touch controls (an analog stick snapped to four directions, a Bomb button and a Kick button), read once per
// fixed step. The newest direction key held wins, so changing direction is instant.

const DIRS = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const GAME_KEYS = new Set([...Object.keys(DIRS), 'Space', 'KeyE']);

export function createInput(ow) {
  const keys = new Set();
  let order = [];
  let bombLatch = false;
  let kickLatch = false;
  let anyKey = false;
  let axis = 'x';
  let wasBomb = false;
  let wasKick = false;

  const clear = () => {
    keys.clear();
    order = [];
  };
  addEventListener('keydown', (e) => {
    const code = e.code;
    if (GAME_KEYS.has(code) && !e.metaKey && !e.ctrlKey) e.preventDefault?.();
    anyKey = true;
    if (e.repeat) return;
    keys.add(code);
    if (DIRS[code]) {
      order = order.filter((c) => c !== code);
      order.push(code);
    } else if (code === 'Space') bombLatch = true;
    else if (code === 'KeyE') kickLatch = true;
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    order = order.filter((c) => c !== e.code);
  });
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });

  const stickOf = () => {
    try {
      return ow?.controls?.stick ?? null;
    } catch {
      return null;
    }
  };
  const held = (id) => {
    try {
      return Boolean(ow?.controls?.pressed(id));
    } catch {
      return false;
    }
  };

  return {
    /** Fills `out`: dx, dy (one of them 0), bomb and kick (pressed since the last sample). */
    sample(out) {
      let dx = 0;
      let dy = 0;
      for (let i = order.length - 1; i >= 0; i--) {
        if (keys.has(order[i])) {
          dx = DIRS[order[i]][0];
          dy = DIRS[order[i]][1];
          break;
        }
      }
      if (dx === 0 && dy === 0) {
        const st = stickOf();
        if (st && Math.hypot(st.x, st.y) > 0.32) {
          const ax = Math.abs(st.x);
          const ay = Math.abs(st.y);
          // stay on the axis you are on until the thumb has clearly moved to the other
          if (axis === 'x' ? ay > ax * 1.35 : ax > ay * 1.35) axis = axis === 'x' ? 'y' : 'x';
          if (axis === 'x') dx = st.x > 0 ? 1 : -1;
          else dy = st.y > 0 ? 1 : -1;
        }
      }
      const bomb = held('bomb');
      const kick = held('kick');
      if (bomb && !wasBomb) bombLatch = true;
      if (kick && !wasKick) kickLatch = true;
      wasBomb = bomb;
      wasKick = kick;
      out.dx = dx;
      out.dy = dy;
      out.bomb = bombLatch;
      out.kick = kickLatch;
      bombLatch = false;
      kickLatch = false;
      return out;
    },
    /** Forget presses made on another screen. */
    reset() {
      bombLatch = false;
      kickLatch = false;
    },
    get anyKey() {
      return anyKey;
    },
  };
}
