import { describe, expect, it, vi } from 'vitest';
import { CameraDragController } from '../../../src/ui/CameraDragController';

function createSceneStub() {
  const handlers = new Map<string, ((pointer: any) => void)[]>();
  const input = {
    on: vi.fn((event: string, cb: (pointer: any) => void) => {
      const list = handlers.get(event) || [];
      list.push(cb);
      handlers.set(event, list);
    }),
    off: vi.fn((event: string, cb: (pointer: any) => void) => {
      const list = handlers.get(event) || [];
      handlers.set(event, list.filter((fn) => fn !== cb));
    }),
    emit: (event: string, pointer: any) => {
      for (const cb of handlers.get(event) || []) cb(pointer);
    },
    hitTestPointer: vi.fn(() => []),
  };

  const camera = {
    width: 100,
    height: 100,
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
  };

  return {
    scene: {
      input,
      cameras: { main: camera },
    },
    input,
    camera,
  };
}

describe('ui/CameraDragController', () => {
  it('distinguishes click from drag using threshold', () => {
    const { scene, input } = createSceneStub();
    const controller = new CameraDragController(scene as any, {
      worldWidth: 100,
      worldHeight: 100,
      tileSize: 10,
    });
    controller.enable();

    input.emit('pointerdown', { button: 0, x: 10, y: 10 });
    input.emit('pointermove', { x: 12, y: 12, prevPosition: { x: 10, y: 10 } });
    input.emit('pointerup', {});

    expect(controller.wasDragging()).toBe(false);

    input.emit('pointerdown', { button: 0, x: 10, y: 10 });
    input.emit('pointermove', { x: 20, y: 20, prevPosition: { x: 10, y: 10 } });
    input.emit('pointerup', {});

    expect(controller.wasDragging()).toBe(true);
    expect(controller.wasDragging()).toBe(false);
    controller.destroy();
  });

  it('clamps camera panning and lerps back toward player after manual pan', () => {
    const { scene, input, camera } = createSceneStub();
    const controller = new CameraDragController(scene as any, {
      worldWidth: 100,
      worldHeight: 100,
      tileSize: 10,
    });
    controller.enable();

    input.emit('pointerdown', { button: 0, x: 10, y: 10 });
    input.emit('pointermove', { x: -100, y: -100, prevPosition: { x: 10, y: 10 } });
    input.emit('pointerup', {});

    expect(camera.scrollX).toBeLessThanOrEqual(10);
    expect(camera.scrollY).toBeLessThanOrEqual(10);
    expect(camera.scrollX).toBeGreaterThanOrEqual(-10);
    expect(camera.scrollY).toBeGreaterThanOrEqual(-10);

    const before = camera.scrollX;
    controller.onPlayerMove(50, 50);
    expect(camera.scrollX).toBeLessThanOrEqual(before);
    controller.destroy();
  });
});

