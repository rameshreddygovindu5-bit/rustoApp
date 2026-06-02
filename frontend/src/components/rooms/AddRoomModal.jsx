import React, { useState } from 'react'
import { roomsAPI } from '../../services/api'
import { toast } from 'react-toastify'

export default function AddRoomModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    room_number: '',
    floor: '',
    room_type: 'non_ac',
    base_tariff: '',
    max_occupancy: 2,
    has_ac: false,
    amenities: '',
    description: ''
  })
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await roomsAPI.create({
        ...formData,
        floor: parseInt(formData.floor),
        base_tariff: parseFloat(formData.base_tariff),
        max_occupancy: parseInt(formData.max_occupancy)
      })
      toast.success('Room added successfully!')
      onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add room')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-navy font-display">Add New Room</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Room Number *</label>
            <input
              type="text"
              name="room_number"
              value={formData.room_number}
              onChange={handleChange}
              required
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Floor *</label>
            <input
              type="number"
              name="floor"
              value={formData.floor}
              onChange={handleChange}
              required
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Room Type *</label>
            <select
              name="room_type"
              value={formData.room_type}
              onChange={handleChange}
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            >
              <option value="non_ac">Non-AC</option>
              <option value="ac">AC</option>
              <option value="deluxe_ac">Deluxe AC</option>
              <option value="house">House</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Base Tariff (₹) *</label>
            <input
              type="number"
              name="base_tariff"
              value={formData.base_tariff}
              onChange={handleChange}
              required
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Max Occupancy</label>
            <input
              type="number"
              name="max_occupancy"
              value={formData.max_occupancy}
              onChange={handleChange}
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="has_ac"
              checked={formData.has_ac}
              onChange={handleChange}
              className="rounded text-navy focus:ring-navy"
            />
            <label className="text-sm font-medium text-gray-700">Has AC</label>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Amenities</label>
            <input
              type="text"
              name="amenities"
              value={formData.amenities}
              onChange={handleChange}
              placeholder="TV, WiFi, Geyser"
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows="2"
              className="w-full mt-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-navy"
            ></textarea>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-navy text-white rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
