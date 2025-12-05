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
    a.floorTexture = createTileTexture('#ffffff', '#999999', 4); 
    a.wallTexture = createTileTexture('#ffffff', '#aaccff', 2); 

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

  const createTileTexture = (color1, color2, segments) => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, size, size);
    
    ctx.strokeStyle = color2;
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, size, size);
    
    // Cross pattern
    ctx.beginPath();
    ctx.moveTo(size/2, 0); ctx.lineTo(size/2, size);
    ctx.moveTo(0, size/2); ctx.lineTo(size, size/2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // 2 repeats per meter = 50cm tiles
    texture.repeat.set(2, 2); 
    return texture;
  };

  const updatePlanes = (frame, a) => {
    const detectedPlanes = frame.detectedPlanes;
    if (!detectedPlanes) return;

    const referenceSpace = a.renderer.xr.getReferenceSpace();

    // 1. First Pass: Find the "Lowest" horizontal plane to identify as the main floor
    let lowestY = Infinity;
    let mainFloorPlane = null;

    detectedPlanes.forEach((plane) => {
      if (plane.orientation === "horizontal") {
        const planePose = frame.getPose(plane.planeSpace, referenceSpace);
        if (planePose) {
          // Matrix element 13 is the Y position (index 13 in column-major 4x4)
          const y = planePose.transform.matrix[13];
          if (y < lowestY) {
            lowestY = y;
            mainFloorPlane = plane;
          }
        }
      }
    });

    // 2. Second Pass: Render geometry based on role (Main Floor vs Table vs Wall)
    detectedPlanes.forEach((plane) => {
      const planePose = frame.getPose(plane.planeSpace, referenceSpace);
      if (planePose) {
        let planeMesh = a.planes.get(plane);

        // -- Initialize Mesh --
        if (!planeMesh) {
          const material = new THREE.MeshStandardMaterial({
            map: plane.orientation === "horizontal" ? a.floorTexture : a.wallTexture,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            roughness: 0.5,
            metalness: 0.1,
            polygonOffset: true, 
            polygonOffsetFactor: -1 // Helps prevent z-fighting with real world
          });
          
          const geometry = new THREE.BufferGeometry();
          planeMesh = new THREE.Mesh(geometry, material);
          planeMesh.matrixAutoUpdate = false; 
          planeMesh.userData = { lastChangedTime: -1, isInfinite: false }; 
          a.scene.add(planeMesh);
          a.planes.set(plane, planeMesh);
        }

        // -- Update Geometry --
        
        // Check if this specific plane is the identified Main Floor
        const isMainFloor = (plane === mainFloorPlane);

        // Case A: Infinite Floor (Only for the lowest horizontal plane)
        if (isMainFloor) {
           if (!planeMesh.userData.isInfinite) {
              // Switch to Infinite Plane Geometry
              const geometry = new THREE.PlaneGeometry(1000, 1000);
              geometry.rotateX(-Math.PI / 2);
              
              // Scale UVs for world-scale tiling (1000m = 1000 repeats)
              const uv = geometry.attributes.uv;
              for (let i = 0; i < uv.count; i++) {
                uv.setXY(i, uv.getX(i) * 1000, uv.getY(i) * 1000);
              }
              
              if (planeMesh.geometry) planeMesh.geometry.dispose();
              planeMesh.geometry = geometry;
              planeMesh.userData.isInfinite = true;
           }
           // No need to update geometry shape every frame for infinite planes
        } 
        // Case B: Bounded Polygon (Walls, Tables, or secondary floor fragments)
        else {
           // If it was infinite before but is no longer the lowest, switch back to polygon
           // OR if it's just a normal update
           if (plane.lastChangedTime !== planeMesh.userData.lastChangedTime || planeMesh.userData.isInfinite) {
              planeMesh.userData.lastChangedTime = plane.lastChangedTime;
              planeMesh.userData.isInfinite = false; // It is not infinite

              const polygon = plane.polygon;
              const shape = new THREE.Shape();
              polygon.forEach((point, i) => {
                if (i === 0) shape.moveTo(point.x, point.z);
                else shape.lineTo(point.x, point.z);
              });
              const geometry = new THREE.ShapeGeometry(shape);
              geometry.rotateX(-Math.PI / 2);

              // World-aligned UV Mapping (Planar Projection)
              // This ensures tiles align even between separate polygons
              const posAttribute = geometry.attributes.position;
              const uvAttribute = geometry.attributes.uv;
              for (let i = 0; i < posAttribute.count; i++) {
                 // We use the Local X/Z which (after rotation) corresponds to Surface Space
                 // To align with World, strictly speaking we'd need world coords, 
                 // but since AR planes are usually aligned to the session origin, 
                 // mapping X/Z usually gives consistent alignment if planes aren't rotated oddly.
                 const x = posAttribute.getX(i);
                 const z = posAttribute.getZ(i);
                 uvAttribute.setXY(i, x, z);
              }
              
              if (planeMesh.geometry) planeMesh.geometry.dispose();
              planeMesh.geometry = geometry;
           }
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
      
      setStatus("Scanning... Lowest surface becomes infinite floor.");
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
      const geometry = new THREE.BoxGeometry(0.2, 0.02, 0.2); 
      const material = new THREE.MeshStandardMaterial({
        color: modeRef.current === "Tile" ? 0xff0000 : 0x0000ff, 
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