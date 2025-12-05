import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { XR, ARButton, useHitTest, Interactive } from '@react-three/xr';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

// --- 1. Texture Loader Component ---
// We use a separate component for textures to handle async loading cleanly
function PlacedObject({ position, orientation, type }) {
  // Try to load textures. If files are missing, it might warn in console but will still render mesh.
  // Make sure 'tile.jpg' and 'textile.jpg' are in your public folder!
  
  // NOTE: For a production app, handle loading errors or use useTexture from @react-three/drei
  const textureMap = useLoader(THREE.TextureLoader, type === 'Floor' ? '/tile.jpg' : '/textile.jpg');

  return (
    <mesh position={position} quaternion={orientation} scale={[0.2, 0.2, 0.05]}>
      <boxGeometry />
      <meshStandardMaterial 
        map={textureMap} 
        color={type === 'Floor' ? 'white' : 'white'} // Fallback color if texture fails
        attach="material"
      />
    </mesh>
  );
}

// --- 2. The Smart Reticle (Detector) ---
function Reticle({ onPlace, setIsFloor }) {
  const ref = useRef();
  const hitNormal = useRef(new THREE.Vector3());

  useHitTest((hitMatrix) => {
    if (ref.current) {
      // 1. Move reticle to the detected surface
      hitMatrix.decompose(ref.current.position, ref.current.quaternion, ref.current.scale);

      // 2. Extract the Normal (Direction the surface is facing)
      // In WebXR, the Y-axis (0, 1, 0) of the hitMatrix represents the surface normal.
      const rotation = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      hitMatrix.decompose(position, rotation, scale);

      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
      
      // 3. Logic: If Y component is > 0.5, it's horizontal (Floor). Otherwise, vertical (Wall).
      const isHorizontal = Math.abs(normal.y) > 0.5;
      
      setIsFloor(isHorizontal); // Update state to tell the UI what we see
    }
  });

  return (
    <Interactive onSelect={onPlace}>
      <mesh ref={ref} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.1, 0.25, 32]} />
        <meshStandardMaterial color="white" opacity={0.8} transparent />
      </mesh>
    </Interactive>
  );
}

// --- 3. Main App ---
function App() {
  const [items, setItems] = useState([]);
  const [isFloor, setIsFloor] = useState(true); // State to track what the camera is looking at

  const placeItem = (e) => {
    // Clone the position and orientation from the hit test result
    const position = e.intersection.point.clone();
    
    // We can get the precise orientation from the object that was hit (the reticle)
    const orientation = e.intersection.object.quaternion.clone();

    setItems([...items, { 
      position, 
      orientation, 
      type: isFloor ? 'Floor' : 'Wall' 
    }]);
  };

  return (
    <>
      {/* UI Overlay */}
      <div style={{ position: 'absolute', zIndex: 10, top: 20, left: 20, color: 'white', fontFamily: 'sans-serif' }}>
        <h1>Surface Detector</h1>
        <div style={{ 
          padding: '15px', 
          background: 'rgba(0,0,0,0.6)', 
          borderRadius: '10px',
          display: 'inline-block'
        }}>
          <p style={{ margin: 0 }}>Detected: <strong style={{ color: isFloor ? '#4ade80' : '#60a5fa' }}>
            {isFloor ? 'FLOOR (Horizontal)' : 'WALL (Vertical)'}
          </strong></p>
          <p style={{ fontSize: '12px', marginTop: '5px' }}>
            Placing: {isFloor ? 'Ceramic Tile' : 'Textile / Wallpaper'}
          </p>
        </div>
      </div>

      <ARButton />

      <Canvas>
        <XR>
          <ambientLight intensity={0.8} />
          <pointLight position={[10, 10, 10]} />

          {/* Pass the detection function down to the reticle */}
          <Reticle onPlace={placeItem} setIsFloor={setIsFloor} />

          {/* Render all placed items */}
          {items.map((item, index) => (
             // We wrap this in Suspense just in case textures load slowly
             <React.Suspense key={index} fallback={null}>
                <PlacedObject 
                  position={item.position} 
                  orientation={item.orientation} 
                  type={item.type} 
                />
             </React.Suspense>
          ))}
        </XR>
      </Canvas>
    </>
  );
}

export default App;