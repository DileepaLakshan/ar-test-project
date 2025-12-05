import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const ARViewer = () => {
  const containerRef = useRef();
  const [isSupported, setIsSupported] = useState(false);
  const [isARActive, setIsARActive] = useState(false);
  const [status, setStatus] = useState("Initializing...");
  const [mode, setMode] = useState("Tile"); 

  const app = useRef({
    scene: null,
    camera: null,
    renderer: null,
    reticle: null,
    hitTestSource: null,
    hitTestSourceRequested: false,
    planes: new Map(),
    items: [],
    gridTexture: null
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const a = app.current;
    a.scene = new THREE.Scene();

    a.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    a.scene.add(light);

    a.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    a.renderer.setPixelRatio(window.devicePixelRatio);
    a.renderer.setSize(window.innerWidth, window.innerHeight);
    a.renderer.xr.enabled = true;
    
    container.appendChild(a.renderer.domElement);

    // --- Generate ARCore-style Grid Texture ---
    a.gridTexture = createARGridTexture();

    // Reticle
    const ringGeo = new THREE.RingGeometry(0.1, 0.15, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    a.reticle = new THREE.Mesh(ringGeo, ringMat);
    a.reticle.matrixAutoUpdate = false;
    a.reticle.visible = false;
    a.scene.add(a.reticle);

    if ("xr" in navigator) {
      navigator.xr.isSessionSupported("immersive-ar").then(setIsSupported);
    }

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

  // --- Helper: Create Grid + Dot Texture (ARCore Style) ---
  const createARGridTexture = () => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Transparent Background
    ctx.clearRect(0, 0, size, size);

    // 2. Draw Grid Border (White, semi-transparent)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, size, size);

    // 3. Draw Dots at corners (to mimic the intersection dots)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const r = 16; 
    
    // Helper to draw circle
    const dot = (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fill();
    };
    
    // Draw dots at 4 corners
    dot(0, 0); dot(size, 0); dot(0, size); dot(size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  };

  // --- Update Planes Logic ---
  const updatePlanes = (frame, a) => {
    const detectedPlanes = frame.detectedPlanes;
    if (!detectedPlanes) return;

    const referenceSpace = a.renderer.xr.getReferenceSpace();

    detectedPlanes.forEach((plane) => {
      const planePose = frame.getPose(plane.planeSpace, referenceSpace);
      
      if (planePose) {
        let planeMesh = a.planes.get(plane);
        
        // Check Orientation
        const isHorizontal = plane.orientation === "horizontal";

        // -- Initialize Mesh --
        if (!planeMesh) {
          const material = new THREE.MeshBasicMaterial({
            // Only apply Grid Texture to Floors (Horizontal)
            map: isHorizontal ? a.gridTexture : null,
            // White for floor, Turquoise for walls
            color: isHorizontal ? 0xffffff : 0x40e0d0, 
            transparent: true,
            opacity: isHorizontal ? 0.8 : 0.3, // Make walls fainter
            side: THREE.DoubleSide,
            depthWrite: false, // Prevents z-fighting
          });
          
          const geometry = new THREE.BufferGeometry();
          planeMesh = new THREE.Mesh(geometry, material);
          planeMesh.matrixAutoUpdate = false; 
          planeMesh.userData = { lastChangedTime: -1 }; 
          a.scene.add(planeMesh);
          a.planes.set(plane, planeMesh);
        }

        // -- Update Geometry (Bounded Polygon) --
        // We use the exact shape detected by AR (Tabletop, Floor segment, etc.)
        if (plane.lastChangedTime !== planeMesh.userData.lastChangedTime) {
          planeMesh.userData.lastChangedTime = plane.lastChangedTime;

          const polygon = plane.polygon;
          const shape = new THREE.Shape();
          polygon.forEach((point, i) => {
            if (i === 0) shape.moveTo(point.x, point.z);
            else shape.lineTo(point.x, point.z);
          });
          
          const geometry = new THREE.ShapeGeometry(shape);
          geometry.rotateX(-Math.PI / 2);

          // -- World-Aligned UV Mapping (Only useful for Grid Texture) --
          if (isHorizontal) {
            // Map UVs directly to World X/Z. 
            // Multiply by a factor to control grid size. 
            // e.g., * 5 means 5 tiles per meter (20cm tiles).
            const scale = 5.0; 
            
            const posAttribute = geometry.attributes.position;
            const uvAttribute = geometry.attributes.uv;
            
            for (let i = 0; i < posAttribute.count; i++) {
               const x = posAttribute.getX(i);
               const z = posAttribute.getZ(i);
               uvAttribute.setXY(i, x * scale, z * scale);
            }
          }
          
          if (planeMesh.geometry) planeMesh.geometry.dispose();
          planeMesh.geometry = geometry;
        }

        // -- Update Position --
        planeMesh.matrix.fromArray(planePose.transform.matrix);
        planeMesh.visible = true;
      }
    });
  };

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
      
      setStatus("Scanning... Surfaces will show grid pattern.");
      setIsARActive(true);

      const controller = a.renderer.xr.getController(0);
      controller.addEventListener("select", onSelect);
      a.scene.add(controller);

      session.addEventListener("end", () => {
        setStatus("Session Ended");
        setIsARActive(false);
        a.hitTestSourceRequested = false;
        a.hitTestSource = null;
        a.reticle.visible = false;
        a.planes.forEach(mesh => a.scene.remove(mesh));
        a.planes.clear();
      });

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

        const rotationMatrix = new THREE.Matrix4().extractRotation(a.reticle.matrix);
        const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotationMatrix);
        
        if (Math.abs(up.y) > 0.5) {
            a.reticle.material.color.setHex(0x00ff00); 
        } else {
            a.reticle.material.color.setHex(0x00ffff); 
        }
      } else {
        a.reticle.visible = false;
      }
    }
  };

  const onSelect = () => {
    const a = app.current;
    if (a.reticle.visible) {
      // Create a marker object
      const geometry = new THREE.CylinderGeometry(0.05, 0.0, 0.1, 32); 
      const material = new THREE.MeshStandardMaterial({
        color: modeRef.current === "Tile" ? 0xff0000 : 0x0000ff, 
        roughness: 0.2
      });
      const mesh = new THREE.Mesh(geometry, material);
      
      // Pivot adjust so cylinder sits on ground
      geometry.translate(0, 0.05, 0);

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
        backgroundColor: isARActive ? "transparent" : "#000" 
      }}
    >
      <div style={{
        position: "absolute", top: 20, left: 20, zIndex: 10,
        color: "white", fontFamily: "sans-serif", background: "rgba(0,0,0,0.5)", padding: "10px", borderRadius: "8px"
      }}>
        <h2 style={{margin: "0 0 10px 0"}}>AR Surface Designer</h2>
        <div style={{marginBottom: "10px"}}>Status: {status}</div>
        <div style={{fontSize: "0.9em", marginBottom: "10px"}}>Scan surfaces to see grid</div>
        
        <div style={{display: "flex", gap: "10px"}}>
          <button 
            onClick={() => setMode("Tile")}
            style={{
              padding: "10px", border: "none", borderRadius: "4px", fontWeight: "bold",
              background: mode === "Tile" ? "#ff4444" : "#fff",
              color: mode === "Tile" ? "#fff" : "#000"
            }}
          >
            Red Marker
          </button>
          <button 
            onClick={() => setMode("Textile")}
            style={{
              padding: "10px", border: "none", borderRadius: "4px", fontWeight: "bold",
              background: mode === "Textile" ? "#4444ff" : "#fff",
              color: mode === "Textile" ? "#fff" : "#000"
            }}
          >
            Blue Marker
          </button>
        </div>
      </div>

      {!isSupported && <div style={{position:"absolute", top:"50%", left:0, width:"100%", textAlign:"center", color:"red"}}>WebXR NOT SUPPORTED</div>}

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