import React, { useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

/**
 * SIMULATED AR SETUP
 * Since @react-three/xr is not available in this environment, 
 * we simulate the AR experience.
 * * To switch to Real AR:
 * 1. npm install @react-three/xr
 * 2. Import { XR, ARButton, useHitTest, Interactive } from '@react-three/xr'
 * 3. Wrap everything in <XR> instead of <React.Fragment>
 * 4. Use useHitTest instead of the onPointerMove logic below
 */

/**
 * Reticle Component
 * In a real AR app, this follows the physical world surfaces via useHitTest.
 * Here, we simulate it by tracking the mouse pointer on a virtual floor.
 */
function Reticle({ visible, position, rotation }) {
  return (
    <group position={position} rotation={rotation} visible={visible}>
      {/* The Visual Grid - A GridHelper that shows the plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.25, 32]} />
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.5} />
      </mesh>
      
      {/* A larger grid to visualize the floor plane context */}
      <gridHelper args={[2, 10, 'cyan', 'teal']} position={[0, -0.01, 0]} />
      
      {/* Pulse effect ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.26, 0.28, 32]} />
        <meshBasicMaterial color="cyan" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

/**
 * PlacedObject Component
 * Simple cylinder to show where the user clicked
 */
function PlacedObject({ position }) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[0.05, 0.05, 0.2, 32]} />
      <meshStandardMaterial color="hotpink" roughness={0.3} metalness={0.8} />
    </mesh>
  );
}

/**
 * ARScene Component
 * Manages the scene content and interaction logic
 */
function ARScene() {
  const [objects, setObjects] = useState([]);
  const [reticleData, setReticleData] = useState({
    visible: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0]
  });

  // Simulated Hit Test: Raycast against an invisible floor plane
  const handlePointerMove = (e) => {
    setReticleData({
      visible: true,
      position: e.point,
      rotation: [-Math.PI / 2, 0, 0] // Flat on ground
    });
  };

  const handlePointerMiss = () => {
    setReticleData((prev) => ({ ...prev, visible: false }));
  };

  const handlePlaceObject = (e) => {
    e.stopPropagation();
    if (reticleData.visible) {
      setObjects((prev) => [
        ...prev,
        {
          position: e.point,
          id: Date.now()
        }
      ]);
    }
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

      {/* Invisible Floor for "Hit Testing" simulation */}
      <mesh 
        rotation={[-Math.PI / 2, 0, 0]} 
        position={[0, -0.01, 0]} 
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerMiss}
        onClick={handlePlaceObject}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* The Reticle detects the plane and shows the grid */}
      <Reticle 
        visible={reticleData.visible} 
        position={reticleData.position}
        rotation={[0, 0, 0]} 
      />

      {/* Render placed objects */}
      {objects.map((obj) => (
        <PlacedObject key={obj.id} position={obj.position} />
      ))}
    </>
  );
}

export default function App() {
  return (
    <div className="h-screen w-full bg-gray-900 text-white flex flex-col items-center justify-center relative overflow-hidden">
      
      {/* Overlay UI */}
      <div className="absolute top-10 left-0 w-full z-10 pointer-events-none flex flex-col items-center p-4">
        <h1 className="text-3xl font-bold mb-2 drop-shadow-md">AR Plane Detector (Simulated)</h1>
        <div className="text-sm bg-black/60 px-6 py-3 rounded-xl backdrop-blur-md text-center max-w-md">
          <p className="mb-2"><strong>Simulation Mode Active</strong></p>
          <p className="text-gray-300 text-xs">
            Since WebXR isn't available in this preview, we are simulating plane detection.
            Move your mouse (or drag finger) to move the reticle. Click/Tap to place markers.
          </p>
        </div>
      </div>

      <Canvas shadows>
        {/* Camera setup for simulation */}
        <PerspectiveCamera makeDefault position={[0, 2, 4]} fov={50} />
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.2} />
        
        <ARScene />
        
        {/* Background grid to give context in 3D space */}
        <gridHelper args={[20, 20, 0x444444, 0x222222]} position={[0, -0.02, 0]} />
      </Canvas>
    </div>
  );
}