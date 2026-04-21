"use client"

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet's default icon path issues
delete (L.Icon.Default.prototype as { _getIconUrl?: string })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface MapProps {
  onRouteUpdate?: (coordinates: number[][], stats: RouteStats) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSearchSelect?: (result: SearchResult) => void;
}

interface SearchResult {
  center: [number, number];
  place_name: string;
}

interface RouteStats {
  distance: number;
  duration: number;
  elevationGain: number;
}

type Coordinate = [number, number]

export default function Map({ 
  onRouteUpdate, 
  searchQuery = "", 
  onSearchQueryChange,
  onSearchSelect 
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const routeLayer = useRef<L.Polyline | null>(null)
  const markersLayer = useRef<L.LayerGroup | null>(null)

  const [coordinates, setCoordinates] = useState<Coordinate[]>([])
  const [mapLoaded, setMapLoaded] = useState(false)
  const [showAlignButton, setShowAlignButton] = useState(false)
  const [isAligning, setIsAligning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Handle search input changes
  useEffect(() => {
    const searchLocation = async () => {
      if (!searchQuery) {
        setSearchResults([])
        return
      }

      setIsSearching(true)
      try {
        console.log('Searching for:', searchQuery)
        // Using Nominatim for OpenStreetMap
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5`
        )
        if (!response.ok) {
          throw new Error('Search failed')
        }
        
        const data = await response.json()
        console.log('Search results:', data)
        
        if (data && data.length > 0) {
          const formattedResults = data.map((item: { lon: string, lat: string, display_name: string }) => ({
            center: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
            place_name: item.display_name
          }))
          setSearchResults(formattedResults)
          setError(null)
        } else {
          setSearchResults([])
          setError('No results found')
        }
      } catch (err) {
        console.error('Search error:', err)
        setError('Failed to search location')
      } finally {
        setIsSearching(false)
      }
    }

    if (searchQuery.length >= 2) {
      // Increased debounce for Nominatim API
      const debounceTimer = setTimeout(searchLocation, 1000)
      return () => clearTimeout(debounceTimer)
    } else {
      setSearchResults([])
    }
  }, [searchQuery])

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    onSearchQueryChange?.(value)
  }

  const handleSearchSelect = (result: SearchResult) => {
    if (!map.current) return

    const [lng, lat] = result.center
    map.current.flyTo([lat, lng], 14)

    onSearchSelect?.(result)
    setSearchResults([])
  }

  // Calculate route statistics
  const calculateRouteStats = async (coords: Coordinate[]): Promise<RouteStats> => {
    let distance = 0;
    let elevationGain = 0;

    for (let i = 1; i < coords.length; i++) {
      const [lon1, lat1] = coords[i - 1];
      const [lon2, lat2] = coords[i];
      
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distance += R * c;
    }

    elevationGain = Math.round(distance * 25);

    const baseDuration = distance * 5.5;
    const elevationTime = elevationGain / 60;
    const turns = coords.length - 1;
    const turnsTime = (turns * 5) / 60;
    
    const duration = baseDuration + elevationTime + turnsTime;

    return {
      distance,
      duration,
      elevationGain
    };
  }

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    const mapInstance = L.map(mapContainer.current).setView([48.8566, 2.3522], 13)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapInstance)

    routeLayer.current = L.polyline([], {
      color: '#ff4400',
      weight: 3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance)

    markersLayer.current = L.layerGroup().addTo(mapInstance)

    map.current = mapInstance
    setMapLoaded(true)

    return () => {
      mapInstance.remove()
      map.current = null
      setMapLoaded(false)
    }
  }, [])

  // Handle map clicks and route drawing
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    const handleClick = async (e: L.LeafletMouseEvent) => {
      // Clear search results when clicking on map
      setSearchResults([])
      onSearchQueryChange?.("")

      const newCoord: Coordinate = [e.latlng.lng, e.latlng.lat]
      const newCoords = [...coordinates, newCoord]
      setCoordinates(newCoords)
      
      try {
        const stats = await calculateRouteStats(newCoords)
        onRouteUpdate?.(newCoords, stats)

        if (routeLayer.current) {
          routeLayer.current.setLatLngs(newCoords.map(coord => [coord[1], coord[0]]))
        }

        if (markersLayer.current) {
          L.circleMarker([e.latlng.lat, e.latlng.lng], {
            radius: 4,
            color: '#ff4400',
            fillColor: '#ff4400',
            fillOpacity: 1
          }).addTo(markersLayer.current)
        }

        // Show align button when we have at least 2 points
        if (newCoords.length >= 2) {
          setShowAlignButton(true)
        }
        setError(null)
      } catch (error) {
        console.error('Error calculating route stats:', error)
        setError('Failed to calculate route statistics')
      }
    }

    map.current.on('click', handleClick)

    return () => {
      if (map.current) {
        map.current.off('click', handleClick)
      }
    }
  }, [mapLoaded, coordinates, onRouteUpdate])

  const resetPoints = () => {
    setCoordinates([])
    
    if (markersLayer.current) {
      markersLayer.current.clearLayers()
    }

    if (routeLayer.current) {
      routeLayer.current.setLatLngs([])
    }

    setShowAlignButton(false)
    onRouteUpdate?.([], { distance: 0, duration: 0, elevationGain: 0 })
  }

  return (
    <div className="relative z-0">
      <div className="relative mb-4">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            placeholder="Search for a location..."
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            autoComplete="off"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin h-5 w-5 border-2 border-orange-500 rounded-full border-t-transparent"></div>
            </div>
          )}
        </div>
        {searchResults.length > 0 && (
          <ul className="absolute z-10 w-full bg-white border rounded-lg mt-1 max-h-60 overflow-y-auto shadow-lg">
            {searchResults.map((result, index) => (
              <li
                key={`${result.place_name}-${index}`}
                className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-black"
                onClick={() => handleSearchSelect(result)}
              >
                {result.place_name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={mapContainer} className="h-[600px] w-full rounded-lg z-0" />
      {showAlignButton && (
        <div className="absolute bottom-4 left-4 flex gap-2 z-[1000]">
          <button
            onClick={async () => {
              setIsAligning(true)
              try {
                // Using OSRM for routing since mapbox was removed
                const coordsString = coordinates.map(coord => `${coord[0]},${coord[1]}`).join(';')
                const response = await fetch(
                  `https://router.project-osrm.org/route/v1/foot/${coordsString}?overview=full&geometries=geojson`
                )

                if (!response.ok) throw new Error('Failed to align route')
                
                const data = await response.json()
                if (data.routes && data.routes[0]) {
                  const alignedCoords = data.routes[0].geometry.coordinates as Coordinate[]
                  setCoordinates(alignedCoords)
                  
                  // Update the route line
                  if (routeLayer.current) {
                    routeLayer.current.setLatLngs(alignedCoords.map(coord => [coord[1], coord[0]]))
                  }
                  
                  // Update markers (only first and last, or maybe we don't need markers for the whole path)
                  if (markersLayer.current) {
                    markersLayer.current.clearLayers()
                    alignedCoords.forEach(coord => {
                       L.circleMarker([coord[1], coord[0]], {
                        radius: 2,
                        color: '#ff4400',
                        fillColor: '#ff4400',
                        fillOpacity: 0.5,
                        stroke: false
                      }).addTo(markersLayer.current!)
                    })
                  }
                  
                  // Update stats
                  const stats = await calculateRouteStats(alignedCoords)
                  onRouteUpdate?.(alignedCoords, stats)
                }
              } catch (err) {
                console.error('Error aligning to roads:', err)
                setError('Failed to align route to roads')
              } finally {
                setIsAligning(false)
              }
            }}
            disabled={isAligning}
            className="bg-white px-6 py-3 rounded-lg shadow-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-gray-800"
          >
            {isAligning ? 'Aligning...' : 'Align to Roads'}
          </button>
          <button
            onClick={resetPoints}
            disabled={isAligning}
            className="bg-white px-6 py-3 rounded-lg shadow-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-gray-800"
          >
            Reset Points
          </button>
        </div>
      )}
      {error && (
        <div className="absolute bottom-20 left-4 right-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg z-[1000]">
          {error}
        </div>
      )}
    </div>
  )
}
