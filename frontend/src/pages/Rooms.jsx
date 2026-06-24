import React, { useState, useEffect, useCallback } from 'react'
import { roomsAPI } from '../services/api'
import { toast } from 'react-toastify'
import { BedDouble, Wifi, Thermometer, Tv, RefreshCw, Filter } from 'lucide-react'
import CheckinModal from '../components/checkins/CheckinModal'
import RoomDetailModal from '../components/rooms/RoomDetailModal'
import { useLocation } from 'react-router-dom'
import AddRoomModal from '../components/rooms/AddRoomModal'

const STATUS_CONFIG = {
  available: { label: 'Available', color: 'room-available', dot: 'bg-green-500', badge: 'badge-available' },
  occupied: { label: 'Occupied', color: 'room-occupied', dot: 'bg-red-500', badge: 'badge-occupied' },
  checkout_due: { label: 'Checkout Due', color: 'room-checkout_due', dot: 'bg-orange-500', badge: 'badge-checkout_due' },
  maintenance: { label: 'Maintenance', color: 'room-maintenance', dot: 'bg-ink-400', badge: 'badge-maintenance' },
  blocked: { label: 'Blocked', color: 'room-maintenance', dot: 'bg-ink-400', badge: 'badge-maintenance' },
}

const ROOM_TYPE_ICONS = {
  deluxe_ac: '⭐', ac: '❄️', non_ac: '🌀', house: '🏠'
}

export default function Rooms() {
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [floorFilter, setFloorFilter] = useState('all')
  const [checkinModal, setCheckinModal] = useState(null)  // room to checkin
  const [detailModal, setDetailModal] = useState(null)    // occupied room
  const [showAddModal, setShowAddModal] = useState(false)
  const location = useLocation()

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    try {
      const params = {}
      const urlParams = new URLSearchParams(location.search)
      const urlFilter = urlParams.get('filter')
      const urlType = urlParams.get('type')
      
      const activeFilter = urlFilter || filter
      const activeType = urlType || typeFilter
      
      if (activeFilter !== 'all') params.status = activeFilter
      if (activeType !== 'all') params.type = activeType
      if (floorFilter !== 'all') params.floor = floorFilter
      
      const res = await roomsAPI.list(params)
      setRooms(res.data)
      
      // Update state to match URL
      if (urlFilter) setFilter(urlFilter)
      if (urlType) setTypeFilter(urlType)
    } catch {
      toast.error('Failed to load rooms')
    } finally {
      setLoading(false)
    }
  }, [filter, typeFilter, floorFilter, location.search])

  useEffect(() => {
    fetchRooms()
  }, [fetchRooms])

  // Refetch when the AI agent mutates room/check-in state.
  useEffect(() => {
    const onAgentChange = () => fetchRooms()
    window.addEventListener('lms:agent:data_changed', onAgentChange)
    return () => window.removeEventListener('lms:agent:data_changed', onAgentChange)
  }, [fetchRooms])

  const handleRoomClick = (room) => {
    setDetailModal(room)
  }

  const floors = [...new Set(rooms.map(r => r.floor))].sort()

  const statCounts = rooms.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-navy">Room Management</h1>
          <p className="text-xs sm:text-sm text-ink-500">
            {rooms.length} rooms · {statCounts.available || 0} available · {statCounts.occupied || 0} occupied
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => setShowAddModal(true)} className="flex items-center justify-center gap-2 px-4 py-2 bg-gold text-navy-dark rounded-xl text-sm hover:bg-opacity-90 transition-colors flex-1 sm:flex-none">
            + Add Room
          </button>
          <button onClick={fetchRooms} className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-ink-200 rounded-xl text-sm text-ink-600 hover:bg-ink-50 transition-colors flex-1 sm:flex-none">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] sm:text-xs bg-white/50 p-3 rounded-xl border border-ink-100">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
            <span className="text-ink-600 font-medium">{cfg.label} ({statCounts[key] || 0})</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-3 sm:p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <Filter size={14} className="text-ink-400 flex-shrink-0" />
            <div className="flex gap-2">
              {['all', 'available', 'occupied', 'checkout_due', 'maintenance'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    filter === f ? 'bg-navy text-white shadow-md' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}>
                  {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 border-t border-ink-100 pt-3">
             <div className="flex gap-2">
              {['all', 'deluxe_ac', 'ac', 'non_ac', 'house'].map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    typeFilter === t ? 'bg-gold text-navy-dark shadow-md' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}>
                  {t === 'all' ? 'All Types' : t.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Room grid by floor */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-navy border-t-gold rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {floors.map(floor => {
            const floorRooms = rooms.filter(r => r.floor === floor)
            if (floorRooms.length === 0) return null
            return (
              <div key={floor} className="animate-slide-up" style={{ animationDelay: `${floor * 60}ms` }}>
                <h2 className="font-display font-semibold text-navy mb-3 flex items-center gap-2">
                  <span className="w-7 h-7 bg-navy text-white rounded-lg flex items-center justify-center text-sm font-bold">
                    {floor}
                  </span>
                  Floor {floor}
                  <span className="text-ink-400 text-sm font-body font-normal">({floorRooms.length} rooms)</span>
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                  {floorRooms.map((room, idx) => {
                    const cfg = STATUS_CONFIG[room.status] || STATUS_CONFIG.available
                    const isOccupied = room.status === 'occupied'
                    const isCheckoutDue = room.status === 'checkout_due'
                    return (
                      <div
                        key={room.room_id}
                        className={`room-card ${cfg.color} animate-pop-in ${isCheckoutDue ? 'lantern-glow' : ''}`}
                        style={{ animationDelay: `${idx * 25}ms` }}
                        onClick={() => handleRoomClick(room)}
                      >
                        <div className="flex items-center justify-between mb-2 relative z-10">
                          <span className="text-lg font-display font-bold text-navy">
                            {room.room_number}
                          </span>
                          {/* Live status dot — pulses softly for occupied rooms so
                              you can see "this is in use right now" at a glance. */}
                          <span className={`relative flex w-2.5 h-2.5`}>
                            {isOccupied && (
                              <span className={`absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60 animate-ping`}/>
                            )}
                            <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                          </span>
                        </div>
                        <div className="text-xl mb-1 relative z-10 group-hover:scale-110 transition-transform">{ROOM_TYPE_ICONS[room.room_type] || '🏨'}</div>
                        <p className="text-[10px] text-ink-500 leading-tight relative z-10">
                          {room.room_type?.replace('_', ' ').toUpperCase()}
                        </p>
                        <p className="text-xs font-semibold text-navy mt-1 relative z-10">
                          ₹{room.base_tariff?.toLocaleString('en-IN')}
                        </p>
                        {room.active_checkin && (
                          <p className="text-[10px] text-ink-500 truncate mt-1 relative z-10">
                            {room.active_checkin.customer_name?.split(' ')[0]}
                          </p>
                        )}
                        <div className={`mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded text-center relative z-10 ${cfg.badge}`}>
                          {cfg.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Room Modal */}
      {showAddModal && (
        <AddRoomModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); fetchRooms() }}
        />
      )}

      {/* Checkin Modal */}
      {checkinModal && (
        <CheckinModal
          room={checkinModal}
          onClose={() => setCheckinModal(null)}
          onSuccess={() => { setCheckinModal(null); fetchRooms() }}
        />
      )}

      {/* Room Detail Modal */}
      {detailModal && (
        <RoomDetailModal
          room={detailModal}
          onClose={() => setDetailModal(null)}
          onCheckout={() => { setDetailModal(null); fetchRooms() }}
        />
      )}
    </div>
  )
}
