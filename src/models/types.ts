import type { MutableRefObject } from 'react';

/**
 * Per-entity animation input, written by the entity renderer every frame and read by
 * model components inside their own useFrame. Models never move themselves in the world:
 * the parent group is positioned/rotated; models only animate their parts (legs, wings…).
 */
export interface AnimState {
  /** horizontal speed in world units per second */
  speed: number;
  /** ANIM.* mode from shared/protocol (IDLE, WALK, RUN, FLY, SWIM) */
  mode: number;
  /** performance.now() ms of the most recent attack/ability (0 = never) */
  attackAt: number;
  /** performance.now() ms of the most recent time this entity took damage (0 = never) */
  hurtAt: number;
}

export type AnimRef = MutableRefObject<AnimState>;

export const newAnim = (): AnimState => ({ speed: 0, mode: 0, attackAt: 0, hurtAt: 0 });
