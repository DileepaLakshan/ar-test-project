import React, { useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * ⚠️ IMPORTANT FOR LOCAL DEVELOPMENT ⚠️
 * The preview environment here does not support '@react-three/xr'.
 * * TO ENABLE REAL AR ON YOUR PHONE:
 * 1. npm install @react-three/xr
 * 2. Uncomment the import below.
 * 3. Remove/Comment out the "MOCK COMPONENTS" section below.
 */

// [REAL AR IMPORT] - Uncomment this line in your local project
// import { XR, ARButton, useHitTest, Interactive } from '@react-three/xr';

// [MOCK COMPONENTS] - Remove these when running locally with the real library
const XR = ({ children }) => <>{children}</>;
const Interactive = ({ onSelect, children }) => <group onClick={onSelect}>{children}</group>;
const ARButton = () => (
  <button 
    className="absolute bottom-10 z-20 bg-gray-600 text-white font-bold py-3 px-8 rounded-full shadow-lg"
    onClick={() => alert("This is a mock button. Run locally with @react-three/xr to enter AR.")}
  >
    Start AR (Mock)
  </button>
);
// Mock useHitTest: acts like a loop but doesn't do real hit testing in preview
const useHitTest = (callback) => {
  useFrame((state) => {
    // In a real app, this provides the hit matrix from the AR Session.
    // Here we do nothing, so the reticle stays at 0,0,0
  });
};

/**
 * Reticle Component
 * Tracks the real-world surfaces using WebXR Hit Test.
 */
function Reticle({ onPlace }) {
  const ref = useRef();

  // continuously checks for surfaces in the real world
  useHitTest((hitMatrix, hit) => {
    // If a surface is found, move this mesh to that position/rotation
    if (ref.current) {
      hitMatrix.decompose(
        ref.current.position,
        ref.current.quaternion,
        ref.current.scale
      );
    }
  });

  return (
    <group ref={ref}>
      {/* Visual Marker for the Reticle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.25, 32]} />
        <meshStandardMaterial color="white" />
      </mesh>
      
      {/* Dynamic Grid to visualize the detected plane */}
      <gridHelper args={[2, 10, 'cyan', 'teal']} position={[0, -0.01, 0]} />

      {/* Invisible interactive plane to handle taps */}
      {/* When the user taps specifically on this reticle, we trigger placement */}
      <Interactive onSelect={onPlace}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <circleGeometry args={[0.3, 32]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </Interactive>
    </group>
  );
}

/**
 * PlacedObject Component
 * The 3D object that gets spawned
 */
function PlacedObject({ position, rotation }) {
  return (
    <mesh position={position} rotation={rotation}>
      <cylinderGeometry args={[0.05, 0.05, 0.2, 32]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
}

/**
 * ARScene Component
 * Manages the XR session content
 */
function ARScene() {
  const [objects, setObjects] = useState([]);

  // Callback when reticle is tapped
  const placeObject = (e) => {
    // The event contains the intersection point where the tap occurred
    // relative to the Reticle's current position in the real world.
    
    // NOTE: In the mock Interactive component, e.intersection might be different
    // than in WebXR. In WebXR, 'e' is an XRInteractionEvent.
    // We'll use a fallback for safety here.
    const point = e.intersection ? e.intersection.point : new THREE.Vector3(0, 0, 0);
    const rotation = e.intersection ? e.intersection.object.rotation : new THREE.Euler();

    setObjects((prev) => [
      ...prev,
      {
        id: Date.now(),
        position: point,
        rotation: rotation
      }
    ]);
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />

      {/* The Reticle drives the interaction */}
      <Reticle onPlace={placeObject} />

      {/* Render all placed objects */}
      {objects.map((obj) => (
        <PlacedObject 
          key={obj.id} 
          position={obj.position} 
          rotation={obj.rotation} 
        />
      ))}
    </>
  );
}

export default function App() {
  return (
    <div className="h-screen w-full bg-black text-white flex flex-col items-center justify-center">
      
      {/* Overlay UI instructions */}
      <div className="absolute top-10 left-0 w-full z-10 pointer-events-none flex flex-col items-center p-4">
        <h1 className="text-2xl font-bold mb-2 drop-shadow-md">AR Plane Detector</h1>
        <p className="text-sm bg-black/50 px-4 py-2 rounded-full backdrop-blur-sm">
          Point camera at floor &bull; Tap grid to place
        </p>
      </div>

      {/* ARButton handles the WebXR session request. */}
      {/* In Real AR, pass sessionInit={{ requiredFeatures: ['hit-test'] }} */}
      <ARButton />

      <Canvas>
        <XR>
          <ARScene />
        </XR>
      </Canvas>
    </div>
  );
}