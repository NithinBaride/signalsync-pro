const { useState, useEffect, useRef, useMemo } = React;

// --- Supabase Config ---
// IMPORTANT: Replace with your actual project URL and Anon public key
const SUPABASE_URL = 'https://aaohmhxcrwgqxapyordi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhb2htaHhjcndncXhhcHlvcmRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Njk5NDgsImV4cCI6MjA5MTI0NTk0OH0.fe61OowITj1HDNFLN0SkitkI6VRjhTQTuQ4iFYEnuXc';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Icons ---
const IconCar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" />
  </svg>
);

const IconUser = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const IconFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" />
  </svg>
);

const IconLocation = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);

// --- Core Physics ---
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRadian = angle => (Math.PI / 180) * angle;
  const distance = (a, b) => (Math.PI / 180) * (a - b);
  const RADIUS_OF_EARTH_IN_KM = 6371;

  const dLat = distance(lat2, lat1);
  const dLon = distance(lon2, lon1);

  lat1 = toRadian(lat1);
  lat2 = toRadian(lat2);

  const a = Math.pow(Math.sin(dLat / 2), 2) +
    Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return RADIUS_OF_EARTH_IN_KM * c;
}

// --- Realtime Engine Hook ---
function useRealtimeV2X(mode, overridePos = null) {
  const [localPos, setLocalPos] = useState(null);
  const [remotePos, setRemotePos] = useState(null);
  const [status, setStatus] = useState('offline'); // 'offline' | 'connected'
  const [remoteSignal, setRemoteSignal] = useState({ active: false, remaining: 0, lat: null, lng: null });
  const [gpsError, setGpsError] = useState(null);

  const channelRef = useRef(null);

  // 1. Setup GPS
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocalPos([latitude, longitude]);
      },
      (err) => {
        if (err.code === 1) setGpsError("Please allow Location Permissions");
        else setGpsError(err.message);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 2. Setup Supabase Channel
  useEffect(() => {
    const channel = supabase.channel('v2x-room');
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'location_update' }, ({ payload }) => {
        if (payload.role !== mode) {
          setRemotePos([payload.lat, payload.lng]);
        }
      })
      .on('broadcast', { event: 'signal_update' }, ({ payload }) => {
        if (mode === 'customer' && payload.role === 'driver') {
          setRemoteSignal(payload.state);
        }
      })
      .subscribe((statusStr) => {
        if (statusStr === 'SUBSCRIBED') setStatus('connected');
        else if (statusStr === 'CLOSED') setStatus('offline');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mode]);

  // 3. Broadcast own location
  useEffect(() => {
    const pos = overridePos || localPos;
    if (pos && status === 'connected') {
      channelRef.current.send({
        type: 'broadcast',
        event: 'location_update',
        payload: { role: mode, lat: pos[0], lng: pos[1] }
      });
    }
  }, [localPos, overridePos, status, mode]);

  const broadcastSignal = (state) => {
    if (mode === 'driver' && status === 'connected') {
      channelRef.current.send({
        type: 'broadcast',
        event: 'signal_update',
        payload: { role: 'driver', state }
      });
    }
  };

  return { localPos, remotePos, status, remoteSignal, broadcastSignal, gpsError };
}

// --- Main App ---
function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const initialMode = queryParams.get('role') === 'customer' ? 'customer' : 'driver';
  const [mode] = useState(initialMode); // strictly read-only mode parameter
  const [driverSignal, setDriverSignal] = useState({ active: false, remaining: 0, lat: null, lng: null });
  const [sliderVal, setSliderVal] = useState(60);
  const [showSlider, setShowSlider] = useState(false);
  const [simulatedPos, setSimulatedPos] = useState(null);
  const [isTripStarted, setIsTripStarted] = useState(false);

  // Broadcast the simulated position if the user is a driver testing the Demo Mode
  const broadcastPos = mode === 'driver' && simulatedPos ? simulatedPos : null;
  const { localPos, remotePos, status, remoteSignal, broadcastSignal, gpsError } = useRealtimeV2X(mode, broadcastPos);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const localMarker = useRef(null);
  const remoteMarker = useRef(null);
  const polylineRef = useRef(null);
  const signalMarker = useRef(null);
  const simulationRef = useRef(null);

  // Initialize Demo Mode (Start offset by ~500-800m)
  useEffect(() => {
    if (mode === 'driver' && localPos && !simulatedPos && !isTripStarted) {
      // Mock Start: Latitude + 0.005, Longitude - 0.005
      setSimulatedPos([localPos[0] + 0.005, localPos[1] - 0.005]);
    } else if (mode === 'customer') {
      setSimulatedPos(null);
      setIsTripStarted(false);
    }
  }, [mode, localPos, isTripStarted]);

  // Demo Mode: Trip Simulation Loop
  useEffect(() => {
    if (!isTripStarted || !remotePos || !simulatedPos || driverSignal.active) {
      clearInterval(simulationRef.current);
      return;
    }

    const startTripInterval = () => {
      setSimulatedPos(prev => {
        if (!prev) return prev;
        const [currLat, currLng] = prev;
        const [destLat, destLng] = remotePos;
        const distKm = haversineDistance(currLat, currLng, destLat, destLng);

        if (distKm < 0.02) {
          // Less than 20 meters, consider arrived
          setIsTripStarted(false);
          return prev;
        }

        // Simulate speed: ~2 meters per 100ms
        const moveRatio = Math.min(0.002 / distKm, 1);
        const nextLat = currLat + (destLat - currLat) * moveRatio;
        const nextLng = currLng + (destLng - currLng) * moveRatio;
        return [nextLat, nextLng];
      });
    };

    simulationRef.current = setInterval(startTripInterval, 100);
    return () => clearInterval(simulationRef.current);
  }, [isTripStarted, remotePos, driverSignal.active]);

  const handleStartTrip = () => {
    if (!remotePos || !simulatedPos) return;
    setIsTripStarted(true);
  };

  // Sync active signal based on mode
  const activeSignal = mode === 'driver' ? driverSignal : remoteSignal;

  // Local effect for driver countdown
  useEffect(() => {
    if (mode !== 'driver' || !driverSignal.active) return;

    if (driverSignal.remaining <= 0) {
      const newState = { ...driverSignal, active: false };
      setDriverSignal(newState);
      broadcastSignal(newState);
      return;
    }

    const id = setInterval(() => {
      setDriverSignal(s => {
        const nextState = { ...s, remaining: s.remaining - 1 };
        broadcastSignal(nextState);
        return nextState;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [driverSignal.active, driverSignal.remaining, mode]);

  // Leaflet map initialization
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    // Fallback coordination (e.g. Center of SF)
    const initialView = [37.7749, -122.4194];

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView(initialView, 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    mapInstance.current = map;
  }, []);

  // Update map coordinates dynamically
  useEffect(() => {
    if (!mapInstance.current) return;

    // We use effectiveLocalPos to switch tracking dynamically between true Raw GPS or Demo Offset GPS
    const effectiveLocalPos = mode === 'driver' && simulatedPos ? simulatedPos : localPos;

    // Determine specific roles for accurate marker rendering
    const driverPos = mode === 'driver' ? effectiveLocalPos : remotePos;
    const customerPos = mode === 'customer' ? effectiveLocalPos : remotePos;

    // 1. Local Customer Pulsing Marker
    if (mode === 'customer' && effectiveLocalPos) {
      if (!localMarker.current) {
        const icon = L.divIcon({
          className: 'user-dot',
          html: '<div class="user-dot-inner"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        localMarker.current = L.marker(effectiveLocalPos, { icon }).addTo(mapInstance.current);
      } else {
        localMarker.current.setLatLng(effectiveLocalPos);
      }
    }

    // 2. Dest/Customer static mock marker for driver (if customer lacks location temporarily)
    if (mode === 'driver' && remotePos) {
      if (!remoteMarker.current) {
        const destIcon = L.divIcon({
          className: 'dest-icon',
          html: `<div class="dest-icon-inner"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });
        remoteMarker.current = L.marker(remotePos, { icon: destIcon }).addTo(mapInstance.current);
      } else {
        remoteMarker.current.setLatLng(remotePos);
      }
    }

    // 3. Driver Car Marker
    if (driverPos) {
      const isLocalDriver = mode === 'driver';
      const ref = isLocalDriver ? localMarker : remoteMarker;

      if (!ref.current) {
        const carHtml = `<div class="car-icon-inner"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg></div>`;
        const carIconType = L.divIcon({
          className: 'car-marker',
          html: carHtml,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });
        ref.current = L.marker(driverPos, { icon: carIconType }).addTo(mapInstance.current);
      } else {
        ref.current.setLatLng(driverPos);
      }
    }

    // 4. Draw Polyline sequence using Leaflet Routing
    if (effectiveLocalPos && remotePos) {
      if (!polylineRef.current) {
        polylineRef.current = L.Routing.control({
          waypoints: [L.latLng(effectiveLocalPos), L.latLng(remotePos)],
          createMarker: () => null, // hide default routing markers
          lineOptions: {
            styles: [{ color: 'var(--accent-blue)', weight: 4, opacity: 0.8 }]
          },
          show: false,
          addWaypoints: false,
          routeWhileDragging: false,
          fitSelectedRoutes: false,
          showAlternatives: false,
        }).addTo(mapInstance.current);
        const container = polylineRef.current.getContainer();
        if (container) container.style.display = 'none'; // Overcome default white layout box
      } else {
        polylineRef.current.setWaypoints([L.latLng(effectiveLocalPos), L.latLng(remotePos)]);
      }
    }

  }, [localPos, remotePos, simulatedPos, mode]);

  // Handle Traffic Signal Overlay
  useEffect(() => {
    if (!mapInstance.current) return;

    // Show overlay globally if active
    if (activeSignal.active) {
      const html = `<div class="signal-overlay"><div class="countdown-orb ${activeSignal.remaining <= 0 ? 'green' : ''}">${activeSignal.remaining > 0 ? activeSignal.remaining : 'Go'}</div></div>`;

      if (!signalMarker.current) {
        const icon = L.divIcon({ className: '', html, iconSize: [80, 80], iconAnchor: [40, 40] });
        signalMarker.current = L.marker([activeSignal.lat, activeSignal.lng], { icon }).addTo(mapInstance.current);

        // Auto pan map to the signal
        mapInstance.current.flyTo([activeSignal.lat, activeSignal.lng], 16, { animate: true });
      } else {
        const icon = L.divIcon({ className: '', html, iconSize: [80, 80], iconAnchor: [40, 40] });
        signalMarker.current.setIcon(icon);
        signalMarker.current.setLatLng([activeSignal.lat, activeSignal.lng]);
      }
    } else {
      if (signalMarker.current) {
        mapInstance.current.removeLayer(signalMarker.current);
        signalMarker.current = null;
      }
    }
  }, [activeSignal]);

  const handleRecenter = () => {
    const effectiveLocalPos = mode === 'driver' && simulatedPos ? simulatedPos : localPos;
    if (mapInstance.current && effectiveLocalPos) {
      mapInstance.current.flyTo(effectiveLocalPos, 16, { animate: true, duration: 0.8 });
    }
  };

  const handleFlagRedLight = () => {
    if (!localPos) return; // Must have GPS
    if (!showSlider) {
      setShowSlider(true);
    } else {
      const newState = {
        active: true,
        remaining: sliderVal,
        lat: localPos[0],
        lng: localPos[1]
      };
      setDriverSignal(newState);
      broadcastSignal(newState);
      setShowSlider(false);
    }
  };

  // ETA Math
  const metrics = useMemo(() => {
    const effectiveLocalPos = mode === 'driver' && simulatedPos ? simulatedPos : localPos;
    if (!effectiveLocalPos || !remotePos) return null;
    const distKm = haversineDistance(effectiveLocalPos[0], effectiveLocalPos[1], remotePos[0], remotePos[1]);
    const distMeters = Math.round(distKm * 1000);
    const assumedSpeedKmh = 48; // ~30 mph
    const hours = distKm / assumedSpeedKmh;
    const mins = Math.ceil(hours * 60) || 1;
    return {
      distKm: distKm.toFixed(2),
      distMeters,
      etaMins: mins
    };
  }, [localPos, simulatedPos, remotePos, mode]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div id="map" ref={mapRef}></div>

      {gpsError && (
        <div style={{ position: 'absolute', top: '70px', left: '24px', right: '24px', zIndex: 100, background: 'var(--accent-red)', padding: '12px', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold' }}>
          {gpsError}
        </div>
      )}

      {/* Recenter Button */}
      {localPos && (
        <div className="recenter-btn" onClick={handleRecenter} title="Recenter Map">
          <IconLocation />
        </div>
      )}

      <div className="ui-layer">
        {/* Header */}
        <div className="header glass-panel interactive">
          <div className="status-pill">
            <div className={`status-dot ${status === 'connected' ? '' : 'gray'}`}></div>
            {status === 'connected' ? 'Synced' : 'Offline'}
          </div>

        </div>

        {/* Bottom Area - Driver */}
        {mode === 'driver' && (
          <div className="bottom-sheet glass-panel interactive">
            {metrics && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 16px' }}>
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>ETA</p>
                  <h3 style={{ fontSize: '20px', marginTop: '2px' }}>{metrics.etaMins} <span style={{ fontSize: '14px', fontWeight: 500 }}>min</span></h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Distance Remaining</p>
                  <h3 style={{ fontSize: '20px', marginTop: '2px' }}>{metrics.distMeters} <span style={{ fontSize: '14px', fontWeight: 500 }}>m</span></h3>
                </div>
              </div>
            )}

            {showSlider && (
              <div className="slider-container">
                <div className="slider-label">
                  <span>Hold Time (Seconds)</span>
                  <span className="slider-val">{sliderVal}s</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  value={sliderVal}
                  onChange={(e) => setSliderVal(parseInt(e.target.value))}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className={`btn-primary ${isTripStarted || !remotePos || driverSignal.active ? 'disabled' : ''}`}
                style={{ flex: 1, backgroundColor: 'var(--accent-blue)', borderColor: 'var(--accent-blue)' }}
                onClick={handleStartTrip}
                disabled={isTripStarted || !remotePos || driverSignal.active}
              >
                {isTripStarted ? 'Driving...' : 'Start Trip'}
              </button>

              <button
                className={`btn-primary ${driverSignal.active ? 'disabled' : ''}`}
                style={{ flex: 1 }}
                onClick={handleFlagRedLight}
                disabled={driverSignal.active}
              >
                <IconFlag />
                {driverSignal.active ? `${driverSignal.remaining}s` : (showSlider ? 'Queue Event' : 'Red Light')}
              </button>
            </div>
          </div>
        )}

        {/* Customer View Overhaul */}
        {mode === 'customer' && metrics && (
          <div className={`bottom-sheet glass-panel ${activeSignal.active ? 'alert-pulse' : ''}`}>
            {activeSignal.active ? (
              <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                <h3 style={{ fontSize: '20px', marginBottom: '8px', color: 'var(--accent-red)' }}>⚠️ Status</h3>
                <p style={{ color: 'var(--text-main)', fontSize: '15px', marginBottom: '16px', lineHeight: '1.4' }}>
                  Driver is temporarily stuck at a traffic signal. The journey will resume shortly.
                </p>
                <div style={{ fontSize: '42px', fontWeight: 'bold' }}>{activeSignal.remaining}s</div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px' }}>
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>Status</p>
                  <h3 style={{ fontSize: '18px', marginTop: '4px' }}>Driver is en route.</h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' }}>ETA</p>
                  <h2 style={{ fontSize: '24px', marginTop: '4px' }}>{metrics.etaMins} <span style={{ fontSize: '14px', fontWeight: 500 }}>min</span></h2>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
