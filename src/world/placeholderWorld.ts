import {
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';

export const createStagingLights = (): Group => {
  const lights = new Group();
  lights.name = 'staging-lights';

  const hemisphere = new HemisphereLight(0xb9c8db, 0x17191d, 1.5);

  const sun = new DirectionalLight(0xffffff, 2.25);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0002;

  lights.add(hemisphere, sun);
  return lights;
};

export const createPlaceholderWorld = (
  visualLayer: Group,
  collisionLayer: Group,
): void => {
  const groundGeometry = new PlaneGeometry(200, 200);
  const groundMaterial = new MeshStandardMaterial({
    color: 0x4a4b4d,
    roughness: 0.96,
    metalness: 0.02,
  });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.name = 'placeholder-lunar-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  visualLayer.add(ground);

  const grid = new GridHelper(200, 100, 0x8f949b, 0x686c72);
  grid.name = 'placement-grid';
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  visualLayer.add(grid);

  createStagingCollisionFloor(collisionLayer);
};

export const createStagingCollisionFloor = (
  collisionLayer: Group,
): void => {
  const collisionFloor = new Mesh(
    new PlaneGeometry(200, 200),
    new MeshBasicMaterial({ visible: false }),
  );
  collisionFloor.name = 'placeholder-collision-floor';
  collisionFloor.rotation.x = -Math.PI / 2;
  collisionFloor.userData.worldCollision = true;
  collisionLayer.add(collisionFloor);
};
