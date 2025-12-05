import React, { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, ARButton, useHitTest, Interactive } from '@react-three/xr';
import { Box, Text } from '@react-three/drei';

// 1. The Reticle (The ring that detects planes)
function Reticle({ onPlace }) {
  const ref = useRef();

  useHitTest((hitMatrix) => {
    // This logic moves the ring to the detected surface (floor or wall)
    if (ref.current) {
      hitMatrix.decompose(ref.current.position, ref.current.quaternion, ref.current.scale);
    }
  });

  return (
    // On click/tap, we call the onPlace function
    <Interactive onSelect={onPlace}>
      <mesh ref={ref} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.1, 0.25, 32]} />
        <meshStandardMaterial color="white" />
      </mesh>
    </Interactive>
  );
}

// 2. The Main App Component
function App() {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('Tile'); // 'Tile' or 'Textile'

  // Function to place an item in the world
  const placeItem = (e) => {
    const position = e.intersection.point;
    // We add a new item to our array
    setItems([...items, { position, type: mode }]);
  };

  return (
    <>
      {/* --- HTML UI LAYER --- */}
      <div style={{ position: 'absolute', zIndex: 10, top: 20, left: 20, color: 'white' }}>
        <h1>AR Surface Test</h1>
        <p>Current Mode: <strong>{mode}</strong></p>
        <button 
          onClick={() => setMode('Tile')} 
          style={{ padding: '10px', marginRight: '10px', background: mode === 'Tile' ? 'lightgreen' : 'white' }}>
          Select Tile
        </button>
        <button 
          onClick={() => setMode('Textile')} 
          style={{ padding: '10px', background: mode === 'Textile' ? 'lightblue' : 'white' }}>
          Select Textile
        </button>
      </div>

      {/* --- AR BUTTON --- */}
      {/* This automatically creates the "START AR" button */}
      <ARButton />

      {/* --- 3D SCENE --- */}
      <Canvas>
        <XR>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />

          {/* The Detection Ring */}
          <Reticle onPlace={placeItem} />

          {/* Render Placed Items */}
          {items.map((item, index) => (
            <mesh key={index} position={item.position} scale={[0.1, 0.1, 0.1]}>
              <boxGeometry />
              {/* Simulate Texture: Red for Tile, Blue for Textile */}
              <meshStandardMaterial color={item.type === 'Tile' ? 'red' : 'blue'} />
            </mesh>
          ))}
        </XR>
      </Canvas>
    </>
  );
}

export default App;