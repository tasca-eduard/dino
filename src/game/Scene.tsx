import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { initInput } from '../input';
import { Animals, Buildings, Enemies, Nature, Plants, Projectiles, RemotePlayers } from './Entities';
import { Environment } from './Environment';
import { LocalPlayer } from './LocalPlayer';
import { startLookups } from './lookup';
import { BuildGhost, TileCursor } from './Targeting';
import { Terrain } from './Terrain';

export function Scene() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    startLookups();
    return initInput(gl.domElement);
  }, [gl]);

  return (
    <>
      <Environment />
      <Terrain />
      <Nature />
      <Buildings />
      <Plants />
      <Animals />
      <Enemies />
      <Projectiles />
      <RemotePlayers />
      <LocalPlayer />
      <TileCursor />
      <BuildGhost />
    </>
  );
}
