import React, { useRef, useState, useEffect } from 'react';
import { Camera as CameraIcon, RefreshCw, Check } from 'lucide-react';

interface CameraProps {
  onCapture: (imageData: string) => void;
  onCancel: () => void;
}

export const Camera: React.FC<CameraProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setError('No se pudo acceder a la cámara. Verifique permisos.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to Base64
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        stopCamera();
        onCapture(imageData);
      }
    }
  };

  if (error) {
    return (
      <div className="p-4 text-center bg-red-100 text-red-800 rounded-lg">
        <p>{error}</p>
        <button onClick={onCancel} className="mt-4 px-4 py-2 bg-red-600 text-white rounded">
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
      <div className="relative w-full max-w-md bg-slate-800 rounded-xl overflow-hidden shadow-2xl border-2 border-yellow-400">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="w-full h-96 object-cover bg-black"
        />
        <canvas ref={canvasRef} className="hidden" />
        
        <div className="absolute bottom-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent flex justify-around items-center">
          <button 
            onClick={onCancel}
            className="p-3 rounded-full bg-slate-600 text-white hover:bg-slate-500"
          >
            Cancelar
          </button>
          <button 
            onClick={takePhoto}
            className="p-4 rounded-full bg-yellow-400 text-slate-900 shadow-lg hover:bg-yellow-300 transform transition hover:scale-105"
          >
            <CameraIcon size={32} />
          </button>
          <button 
            onClick={startCamera} // Retry/Switch logic could go here
            className="p-3 rounded-full bg-slate-600 text-white hover:bg-slate-500"
          >
            <RefreshCw size={24} />
          </button>
        </div>
      </div>
      <p className="mt-4 text-yellow-400 text-sm font-bold animate-pulse">
        Por favor, tome una foto clara de su rostro.
      </p>
    </div>
  );
};