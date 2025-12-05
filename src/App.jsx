import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const ARViewer = () => {
  const containerRef = useRef();
  const [isSupported, setIsSupported] = useState(false);
  const [isARActive, setIsARActive] = useState(false); // Track if AR is running
  const [status, setStatus] = useState("Initializing...");
  const [mode, setMode] = useState("Tile"); // 'Tile' or 'Textile'

  // App state stored in ref to access inside closures/loops without re-renders
  const app = useRef({
    scene: null,
    camera: null,
    renderer: null,
    reticle: null,
    hitTestSource: null,
    hitTestSourceRequested: false,
    planes: new Map(), // To store detected plane meshes
    items: [] // To store placed items
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Initialize Three.js Scene
    const a = app.current;
    a.scene = new THREE.Scene();

    a.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    );

    // Light
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    a.scene.add(light);

    // Renderer
    a.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    a.renderer.setPixelRatio(window.devicePixelRatio);
    a.renderer.setSize(window.innerWidth, window.innerHeight);
    a.renderer.xr.enabled = true;
    
    // Append the canvas to the container
    container.appendChild(a.renderer.domElement);

    // Reticle (The Cursor)
    const ringGeo = new THREE.RingGeometry(0.1, 0.15, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    a.reticle = new THREE.Mesh(ringGeo, ringMat);
    a.reticle.matrixAutoUpdate = false;
    a.reticle.visible = false;
    a.scene.add(a.reticle);

    // Check AR Support
    if ("xr" in navigator) {
      navigator.xr.isSessionSupported("immersive-ar").then(setIsSupported);
    }

    // Resize Handler
    const onResize = () => {
      a.camera.aspect = window.innerWidth / window.innerHeight;
      a.camera.updateProjectionMatrix();
      a.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (a.renderer) {
        a.renderer.dispose();
        const canvas = a.renderer.domElement;
        if (container && container.contains(canvas)) {
          container.removeChild(canvas);
        }
      }
    };
  }, []);

  // --- Logic to visualize planes (The "Tiles" for walls/floors) ---
  const updatePlanes = (frame, a) => {
    const detectedPlanes = frame.detectedPlanes;
    if (!detectedPlanes) return;

    const referenceSpace = a.renderer.xr.getReferenceSpace();

    detectedPlanes.forEach((plane) => {
      const planePose = frame.getPose(plane.planeSpace, referenceSpace);
      
      if (planePose) {
        let planeMesh = a.planes.get(plane);

        // Create mesh if new plane
        if (!planeMesh) {
          const geometry = new THREE.PlaneGeometry(1, 1); // Helper geometry
          geometry.rotateX(-Math.PI / 2); 
          
          const material = new THREE.MeshBasicMaterial({
            color: plane.orientation === "horizontal" ? 0x00ff00 : 0x00ffff, // Green=Floor, Cyan=Wall
            transparent: true,
            opacity: 0.1,
            side: THREE.DoubleSide,
            depthWrite: false, // Don't occlude other objects
          });

          planeMesh = new THREE.Mesh(geometry, material);
          planeMesh.matrixAutoUpdate = false; 
          a.scene.add(planeMesh);
          a.planes.set(plane, planeMesh);
        }

        // Update Position & Rotation
        planeMesh.matrix.fromArray(planePose.transform.matrix);
        planeMesh.visible = true;
      }
    });
  };

  // --- Start AR Session ---
  const startAR = async () => {
    const a = app.current;
    if (!a.renderer) return;

    const sessionInit = {
      requiredFeatures: ["hit-test"], 
      optionalFeatures: ["dom-overlay", "plane-detection"], 
      domOverlay: { root: document.body }
    };

    try {
      const session = await navigator.xr.requestSession("immersive-ar", sessionInit);
      a.renderer.xr.setReferenceSpaceType("local");
      a.renderer.xr.setSession(session);
      
      setStatus("Scanning surfaces...");
      setIsARActive(true); // Hide the start button

      // Controller for taps
      const controller = a.renderer.xr.getController(0);
      controller.addEventListener("select", onSelect);
      a.scene.add(controller);

      session.addEventListener("end", () => {
        setStatus("Session Ended");
        setIsARActive(false); // Show the start button again
        a.hitTestSourceRequested = false;
        a.hitTestSource = null;
        a.reticle.visible = false;
        // Clean up planes
        a.planes.forEach(mesh => a.scene.remove(mesh));
        a.planes.clear();
      });

      // Render Loop
      a.renderer.setAnimationLoop((timestamp, frame) => {
        if (frame) {
          handleHitTest(a, frame);
          updatePlanes(frame, a);
        }
        a.renderer.render(a.scene, a.camera);
      });

    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message);
    }
  };

  const handleHitTest = (a, frame) => {
    const session = a.renderer.xr.getSession();

    if (!a.hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          a.hitTestSource = source;
        });
      });
      session.addEventListener("end", () => {
        a.hitTestSourceRequested = false;
        a.hitTestSource = null;
      });
      a.hitTestSourceRequested = true;
    }

    if (a.hitTestSource) {
      const hitTestResults = frame.getHitTestResults(a.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const referenceSpace = a.renderer.xr.getReferenceSpace();
        const pose = hit.getPose(referenceSpace);

        a.reticle.visible = true;
        a.reticle.matrix.fromArray(pose.transform.matrix);

        // Visual Feedback based on Angle
        const rotationMatrix = new THREE.Matrix4().extractRotation(a.reticle.matrix);
        const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotationMatrix);
        
        if (Math.abs(up.y) > 0.5) {
            a.reticle.material.color.setHex(0x00ff00); // Green (Floor)
        } else {
            a.reticle.material.color.setHex(0x00ffff); // Cyan (Wall)
        }
      } else {
        a.reticle.visible = false;
      }
    }
  };

  const onSelect = () => {
    const a = app.current;
    if (a.reticle.visible) {
      const geometry = new THREE.BoxGeometry(0.2, 0.01, 0.2); 
      const material = new THREE.MeshStandardMaterial({
        color: modeRef.current === "Tile" ? 0xff4444 : 0x4444ff, 
        roughness: 0.5
      });
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.setFromMatrixPosition(a.reticle.matrix);
      mesh.quaternion.setFromRotationMatrix(a.reticle.matrix);

      a.scene.add(mesh);
    }
  };

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  
  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: "100%", 
        height: "100%", 
        position: "relative", 
        // IMPORTANT: Transparent background when AR is active so camera shows through
        backgroundColor: isARActive ? "transparent" : "#000" 
      }}
    >
      {/* UI Overlay */}
      <div style={{
        position: "absolute", top: 20, left: 20, zIndex: 10,
        color: "white", fontFamily: "sans-serif", background: "rgba(0,0,0,0.5)", padding: "10px", borderRadius: "8px"
      }}>
        <h2 style={{margin: "0 0 10px 0"}}>AR Surface Designer</h2>
        <div style={{marginBottom: "10px"}}>Status: {status}</div>
        <div style={{fontSize: "0.9em", marginBottom: "10px"}}>Green=Floor, Cyan=Wall</div>
        
        <div style={{display: "flex", gap: "10px"}}>
          <button 
            onClick={() => setMode("Tile")}
            style={{
              padding: "10px", border: "none", borderRadius: "4px", fontWeight: "bold",
              background: mode === "Tile" ? "#ff4444" : "#fff",
              color: mode === "Tile" ? "#fff" : "#000"
            }}
          >
            Red Tile
          </button>
          <button 
            onClick={() => setMode("Textile")}
            style={{
              padding: "10px", border: "none", borderRadius: "4px", fontWeight: "bold",
              background: mode === "Textile" ? "#4444ff" : "#fff",
              color: mode === "Textile" ? "#fff" : "#000"
            }}
          >
            Blue Textile
          </button>
        </div>
      </div>

      {!isSupported && <div style={{position:"absolute", top:"50%", left:0, width:"100%", textAlign:"center", color:"red"}}>WebXR NOT SUPPORTED</div>}

      {/* Hide Start Button when AR is active */}
      {isSupported && !isARActive && (
        <button 
          onClick={startAR}
          style={{
            position: "absolute", bottom: "30px", left: "50%", transform: "translateX(-50%)",
            padding: "12px 24px", fontSize: "16px", borderRadius: "30px", border: "none",
            background: "#fff", color: "#000", fontWeight: "bold", boxShadow: "0 4px 10px rgba(0,0,0,0.3)"
          }}
        >
          START AR
        </button>
      )}
    </div>
  );
};

export default ARViewer;