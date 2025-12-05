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
    // Cache textures so we don't recreate them every frame
    floorTexture: null,
    wallTexture: null
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

    // --- Generate Tile Textures ---
    a.floorTexture = createTileTexture('#ffffff', '#cccccc', 4); // White/Grey tiles
    a.wallTexture = createTileTexture('#ffffff', '#aaccff', 2);  // White/Blue tiles

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

  // --- Helper: Create Procedural Tile Texture ---
  const createTileTexture = (color1, color2, segments) => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, size, size);
    
    // Grid lines (grout)
    ctx.strokeStyle = color2;
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, size, size);
    
    // Inner pattern if needed, or just simple border
    // Let's make a cross pattern
    ctx.beginPath();
    ctx.moveTo(size/2, 0); ctx.lineTo(size/2, size);
    ctx.moveTo(0, size/2); ctx.lineTo(size, size/2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Assume 1 texture unit = 1 meter. 
    // If we want tiles to be 0.5m, we repeat 2 times per meter.
    texture.repeat.set(2, 2); 
    return texture;
  };

  // --- Logic to visualize planes (The "Tiles" for walls/floors) ---
  const updatePlanes = (frame, a) => {
    const detectedPlanes = frame.detectedPlanes;
    if (!detectedPlanes) return;

    const referenceSpace = a.renderer.xr.getReferenceSpace();

    detectedPlanes.forEach((plane) => {
      const planePose = frame.getPose(plane.planeSpace, referenceSpace);
      
      if (planePose) {
        let planeMesh = a.planes.get(plane);

        // 1. Initial Creation
        if (!planeMesh) {
          const material = new THREE.MeshStandardMaterial({
            map: plane.orientation === "horizontal" ? a.floorTexture : a.wallTexture,
            transparent: true,
            opacity: 0.7, // See-through slightly
            side: THREE.DoubleSide,
            roughness: 0.5,
            metalness: 0.1,
            polygonOffset: true, 
            polygonOffsetFactor: -1 // Pull slightly forward to avoid z-fighting with real floor
          });
          
          // Geometry placeholder
          const geometry = new THREE.BufferGeometry();
          
          planeMesh = new THREE.Mesh(geometry, material);
          planeMesh.matrixAutoUpdate = false; 
          planeMesh.userData = { lastChangedTime: -1 }; // Track updates
          a.scene.add(planeMesh);
          a.planes.set(plane, planeMesh);
        }

        // 2. Update Geometry based on Orientation
        // HORIZONTAL (Floor): Use Infinite Plane
        // VERTICAL (Wall): Use Detected Polygon
        
        if (plane.orientation === "horizontal") {
           // Create geometry only once for floors (Infinite Plane)
           if (!planeMesh.geometry.attributes.position || planeMesh.geometry.type !== 'PlaneGeometry') {
              // Create a huge plane (1000m x 1000m)
              const geometry = new THREE.PlaneGeometry(1000, 1000);
              geometry.rotateX(-Math.PI / 2);
              
              // Scale UVs so texture doesn't stretch. 
              // 1000 meters size = 1000 texture repeats (approx)
              const uv = geometry.attributes.uv;
              for (let i = 0; i < uv.count; i++) {
                uv.setXY(i, uv.getX(i) * 1000, uv.getY(i) * 1000);
              }
              
              if (planeMesh.geometry) planeMesh.geometry.dispose();
              planeMesh.geometry = geometry;
           }
           // We do NOT update geometry on plane.lastChangedTime for floors, 
           // because we want it to stay infinite.
           
        } else {
           // Vertical Walls: Stick to the scanned polygon
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

              // Map UVs to World Coordinates for consistent tiling size on walls
              const posAttribute = geometry.attributes.position;
              const uvAttribute = geometry.attributes.uv;
              
              for (let i = 0; i < posAttribute.count; i++) {
                 const x = posAttribute.getX(i);
                 const z = posAttribute.getZ(i);
                 uvAttribute.setXY(i, x, z);
              }
              
              if (planeMesh.geometry) planeMesh.geometry.dispose();
              planeMesh.geometry = geometry;
           }
        }

        // 3. Update Position & Rotation
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
      // 'plane-detection' is CRITICAL for the floor tiling to work
      optionalFeatures: ["dom-overlay", "plane-detection"], 
      domOverlay: { root: document.body }
    };

    try {
      const session = await navigator.xr.requestSession("immersive-ar", sessionInit);
      a.renderer.xr.setReferenceSpaceType("local");
      a.renderer.xr.setSession(session);
      
      setStatus("Scanning surfaces... Floor will tile infinitely.");
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
      // Place a single distinct tile on top of the grid
      const geometry = new THREE.BoxGeometry(0.2, 0.02, 0.2); 
      const material = new THREE.MeshStandardMaterial({
        color: modeRef.current === "Tile" ? 0xff0000 : 0x0000ff, // Pure Red/Blue to contrast with grid
        roughness: 0.2
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
        backgroundColor: isARActive ? "transparent" : "#000" 
      }}
    >
      <div style={{
        position: "absolute", top: 20, left: 20, zIndex: 10,
        color: "white", fontFamily: "sans-serif", background: "rgba(0,0,0,0.5)", padding: "10px", borderRadius: "8px"
      }}>
        <h2 style={{margin: "0 0 10px 0"}}>AR Surface Designer</h2>
        <div style={{marginBottom: "10px"}}>Status: {status}</div>
        <div style={{fontSize: "0.9em", marginBottom: "10px"}}>Scan floor to expand tiles</div>
        
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