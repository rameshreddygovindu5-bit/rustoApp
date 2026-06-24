import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Star, ThumbsUp, ThumbsDown, Send, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import { feedbackAPI } from '../services/api'

/**
 * Public feedback submission page — guest lands here from the SMS/email
 * link sent after checkout. No auth; the URL's token is the credential.
 *
 * Mounted at /feedback-submit/:token. Reached OUTSIDE the Layout (no
 * sidebar etc.) — see App.jsx routing.
 */
export default function FeedbackSubmit() {
  const { token } = useParams()
  const [valid, setValid] = useState(null)        // null = checking, true/false
  const [guestName, setGuestName] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({
    overall: 0, cleanliness: 0, service: 0, value: 0, location: 0,
    comment: '', would_recommend: null, guest_name: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    feedbackAPI.publicView(token)
      .then(r => {
        setValid(true)
        setGuestName(r.data.guest_name || '')
        setForm(s => ({ ...s, guest_name: r.data.guest_name || '' }))
      })
      .catch(e => {
        setValid(false)
        setError(e.response?.data?.detail || 'Invalid or expired link')
      })
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.overall) { setError('Please rate your overall experience'); return }
    setSaving(true)
    setError('')
    try {
      await feedbackAPI.publicSubmit(token, {
        overall_rating: form.overall,
        cleanliness_rating: form.cleanliness || null,
        service_rating: form.service || null,
        value_rating: form.value || null,
        location_rating: form.location || null,
        comment: form.comment || null,
        would_recommend: form.would_recommend,
        guest_name: form.guest_name || null,
      })
      setSubmitted(true)
    } catch (e) {
      setError(e.response?.data?.detail || 'Submission failed')
    } finally {
      setSaving(false)
    }
  }

  if (valid === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-navy/5 to-gold/10 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy border-t-gold rounded-full animate-spin mx-auto mb-3" />
          <p className="text-navy">Loading…</p>
        </div>
      </div>
    )
  }
  if (valid === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-navy/5 to-gold/10 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl p-8 max-w-md text-center">
          <AlertCircle size={48} className="mx-auto text-red-400 mb-3"/>
          <h1 className="text-xl font-display font-bold text-navy mb-2">Link Invalid</h1>
          <p className="text-ink-500 text-sm">{error}</p>
          <Link to="/" className="btn-back-home-light mt-6">
            <ArrowLeft size={13} /> Back to Rusto Home
          </Link>
        </div>
      </div>
    )
  }
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-navy/5 to-gold/10 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl p-8 max-w-md text-center">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-3"/>
          <h1 className="text-2xl font-display font-bold text-navy mb-2">Thank You!</h1>
          <p className="text-ink-500">Your feedback has been recorded. We appreciate you taking the time to share it.</p>
          <Link to="/" className="btn-back-home-light mt-6">
            <ArrowLeft size={13} /> Discover more stays on Rusto
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy/5 to-gold/10 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[95vh] overflow-y-auto">
        <div className="bg-gradient-to-br from-navy to-navy-light text-white px-6 py-5 rounded-t-2xl">
          <h1 className="text-2xl font-display font-bold">How was your stay?</h1>
          <p className="text-white/70 text-sm mt-1">
            {guestName && `${guestName} — `}your feedback helps us improve.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <BigStarPicker label="Overall Experience *"
                          value={form.overall} onChange={n => setForm(s => ({ ...s, overall: n }))} />
          <div className="grid grid-cols-2 gap-3">
            <SmallStarPicker label="Cleanliness" value={form.cleanliness}
                              onChange={n => setForm(s => ({ ...s, cleanliness: n }))} />
            <SmallStarPicker label="Service" value={form.service}
                              onChange={n => setForm(s => ({ ...s, service: n }))} />
            <SmallStarPicker label="Value for money" value={form.value}
                              onChange={n => setForm(s => ({ ...s, value: n }))} />
            <SmallStarPicker label="Location" value={form.location}
                              onChange={n => setForm(s => ({ ...s, location: n }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy mb-1">What stood out?</label>
            <textarea value={form.comment}
                      onChange={e => setForm(s => ({ ...s, comment: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-ink-300 rounded-lg"
                      placeholder="(optional) tell us what made your stay great, or what we could do better" />
          </div>
          <div>
            <label className="block text-sm font-medium text-navy mb-2">Would you recommend us?</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm(s => ({ ...s, would_recommend: true }))}
                      className={`flex-1 py-2 rounded-lg border-2 flex items-center justify-center gap-2 ${
                        form.would_recommend === true ? 'border-green-500 bg-green-50 text-green-700' : 'border-ivory-200 text-ink-500'
                      }`}>
                <ThumbsUp size={16}/> Yes
              </button>
              <button type="button" onClick={() => setForm(s => ({ ...s, would_recommend: false }))}
                      className={`flex-1 py-2 rounded-lg border-2 flex items-center justify-center gap-2 ${
                        form.would_recommend === false ? 'border-red-500 bg-red-50 text-red-700' : 'border-ivory-200 text-ink-500'
                      }`}>
                <ThumbsDown size={16}/> No
              </button>
            </div>
          </div>
          {!guestName && (
            <div>
              <label className="block text-sm font-medium text-navy mb-1">Your name</label>
              <input type="text" value={form.guest_name}
                     onChange={e => setForm(s => ({ ...s, guest_name: e.target.value }))}
                     className="w-full px-3 py-2 border border-ink-300 rounded-lg"
                     placeholder="(optional)" />
            </div>
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={saving}
                  className="w-full py-3 bg-gold hover:bg-gold/90 text-navy-dark font-semibold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
            <Send size={16}/> {saving ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </div>
      </form>
    </div>
  )
}

function BigStarPicker({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-navy mb-2">{label}</label>
      <div className="flex gap-2 justify-center">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)}>
            <Star size={36}
                  className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-ink-200 hover:text-amber-200'} />
          </button>
        ))}
      </div>
    </div>
  )
}

function SmallStarPicker({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-ink-600 mb-1">{label}</label>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)}>
            <Star size={18}
                  className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-ink-200 hover:text-amber-200'} />
          </button>
        ))}
      </div>
    </div>
  )
}
