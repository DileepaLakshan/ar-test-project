import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [arSupported, setArSupported] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const sessionRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const detectedPlanesRef = useRef(new Map());

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        setArSupported(supported);
        if (!supported) {
          setError('AR not supported on this device');
        }
      });
    } else {
      setError('WebXR not available');
    }
  }, []);

  const initWebGL = (canvas, session) => {
    const gl = canvas.getContext('webgl', { xrCompatible: true });
    if (!gl) {
      throw new Error('WebGL not supported');
    }

    // Vertex shader
    const vsSource = `
      attribute vec3 aPosition;
      uniform mat4 uProjectionMatrix;
      uniform mat4 uViewMatrix;
      uniform mat4 uModelMatrix;
      void main() {
        gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
        gl_PointSize = 8.0;
      }
    `;

    // Fragment shader
    const fsSource = `
      precision mediump float;
      uniform vec4 uColor;
      void main() {
        gl_FragColor = uColor;
      }
    `;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vsSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fsSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader program failed to link');
    }

    gl.useProgram(program);
    
    glRef.current = gl;
    programRef.current = program;
    
    return gl;
  };

  const createGridVertices = (plane) => {
    const vertices = [];
    const size = 0.2; // 20cm grid spacing
    const extent = 2; // 2 meters in each direction
    
    // Create grid lines
    for (let x = -extent; x <= extent; x += size) {
      vertices.push(x, 0, -extent);
      vertices.push(x, 0, extent);
    }
    for (let z = -extent; z <= extent; z += size) {
      vertices.push(-extent, 0, z);
      vertices.push(extent, 0, z);
    }
    
    return new Float32Array(vertices);
  };

  const createDotVertices = (plane) => {
    const vertices = [];
    const size = 0.3; // 30cm dot spacing
    const extent = 2;
    
    // Create dot pattern
    for (let x = -extent; x <= extent; x += size) {
      for (let z = -extent; z <= extent; z += size) {
        vertices.push(x, 0, z);
      }
    }
    
    return new Float32Array(vertices);
  };

  const drawPlane = (gl, program, plane, frame, viewMatrix, projectionMatrix, isVertical) => {
    const pose = frame.getPose(plane.planeSpace, frame.session.referenceSpace);
    if (!pose) return;

    const vertices = isVertical ? createDotVertices(plane) : createGridVertices(plane);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);

    const projMatrixLoc = gl.getUniformLocation(program, 'uProjectionMatrix');
    const viewMatrixLoc = gl.getUniformLocation(program, 'uViewMatrix');
    const modelMatrixLoc = gl.getUniformLocation(program, 'uModelMatrix');
    const colorLoc = gl.getUniformLocation(program, 'uColor');

    gl.uniformMatrix4fv(projMatrixLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewMatrixLoc, false, viewMatrix);
    gl.uniformMatrix4fv(modelMatrixLoc, false, pose.transform.matrix);

    // Green for horizontal (floor), Blue for vertical (walls)
    const color = isVertical ? [0.2, 0.5, 1.0, 0.8] : [0.2, 1.0, 0.5, 0.8];
    gl.uniform4fv(colorLoc, color);

    if (isVertical) {
      gl.drawArrays(gl.POINTS, 0, vertices.length / 3);
    } else {
      gl.drawArrays(gl.LINES, 0, vertices.length / 3);
    }
  };

  const onXRFrame = (time, frame) => {
    const session = frame.session;
    session.requestAnimationFrame(onXRFrame);

    const gl = glRef.current;
    const program = programRef.current;

    const pose = frame.getViewerPose(session.referenceSpace);
    if (!pose) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Detect planes
    const detectedPlanes = frame.detectedPlanes;
    if (detectedPlanes) {
      for (const plane of detectedPlanes) {
        for (const view of pose.views) {
          const viewport = session.renderState.baseLayer.getViewport(view);
          gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

          // Determine if plane is horizontal (floor/ceiling) or vertical (wall)
          const orientation = plane.orientation;
          const isVertical = orientation === 'vertical';

          drawPlane(gl, program, plane, frame, view.transform.inverse.matrix, 
                   view.projectionMatrix, isVertical);
        }
      }
    }
  };

  const startAR = async () => {
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'plane-detection'],
        planeDetectionState: { enabled: true }
      });

      sessionRef.current = session;
      const canvas = canvasRef.current;
      
      const gl = initWebGL(canvas, session);
      
      await gl.makeXRCompatible();
      
      const layer = new XRWebGLLayer(session, gl);
      await session.updateRenderState({ baseLayer: layer });

      const referenceSpace = await session.requestReferenceSpace('local');
      session.referenceSpace = referenceSpace;

      session.requestAnimationFrame(onXRFrame);

      session.addEventListener('end', () => {
        setArActive(false);
        sessionRef.current = null;
      });

      setArActive(true);
    } catch (err) {
      setError(`Failed to start AR: ${err.message}`);
      console.error(err);
    }
  };

  const stopAR = () => {
    if (sessionRef.current) {
      sessionRef.current.end();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
      {!arActive ? (
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold text-white mb-2">WebXR Plane Detection</h1>
          <p className="text-blue-200 mb-8">Detect floors and walls in AR</p>
          
          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-200 px-6 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <button
            onClick={startAR}
            disabled={!arSupported}
            className={`px-8 py-4 rounded-full text-xl font-semibold transition-all transform hover:scale-105 ${
              arSupported
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg hover:shadow-xl'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            View AR
          </button>

          <div className="mt-8 text-sm text-blue-300 max-w-md">
            <p className="mb-2">• Green grid lines = Horizontal surfaces (floors)</p>
            <p>• Blue dots = Vertical surfaces (walls)</p>
          </div>
        </div>
      ) : (
        <div className="fixed top-4 right-4 z-10">
          <button
            onClick={stopAR}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-full font-semibold shadow-lg"
          >
            Exit AR
          </button>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={arActive ? 'fixed inset-0 w-full h-full' : 'hidden'}
      />
    </div>
  );
}