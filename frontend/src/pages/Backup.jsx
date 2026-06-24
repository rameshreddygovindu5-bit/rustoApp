import React, { useState, useEffect } from 'react'
import { Database, Download, AlertCircle, ServerCrash, FileArchive } from 'lucide-react'
import { toast } from 'react-toastify'
import { backupAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Backup page — super-admin only.
 *
 * SQLite deployments: stream the .db file directly.
 * Postgres/MySQL: backend returns guidance to use pg_dump/mysqldump on
 * the host. We surface that message + don't show a Download button.
 */
export default function Backup() {
  const { isSuperAdmin } = useAuth()
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    backupAPI.info()
      .then(r => setInfo(r.data))
      .catch(() => toast.error('Failed to load backup info'))
      .finally(() => setLoading(false))
  }, [])

  if (!isSuperAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6 animate-fade-in">
        <div className="text-center max-w-sm">
          <ServerCrash size={48} className="mx-auto text-red-400 mb-4"/>
          <h2 className="text-xl font-bold text-navy">Super-admin only</h2>
          <p className="text-ink-500 mt-2">Only the super administrator can download backups.</p>
        </div>
      </div>
    )
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await backupAPI.download()
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `lms-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.db`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Download failed')
    } finally { setDownloading(false) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Backup & Restore</h1>
        <p className="text-ink-500 text-sm mt-1">
          Database snapshot management. Backups are audit-logged.
        </p>
      </div>

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : !info ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertCircle size={20} className="text-red-500 flex-shrink-0"/>
          <p className="text-sm text-red-700">Could not retrieve backup information.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center">
                <Database size={22} className="text-gold"/>
              </div>
              <div>
                <h2 className="font-display font-bold text-navy">Database</h2>
                <p className="text-xs text-ink-500 uppercase tracking-wide">{info.backend}</p>
              </div>
            </div>
            {info.downloadable ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <div className="text-xs text-ink-500 uppercase tracking-wide">Size</div>
                    <div className="font-bold text-navy mt-1">{info.size_human}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-500 uppercase tracking-wide">Path</div>
                    <div className="font-mono text-xs text-ink-600 mt-1 truncate" title={info.path}>{info.path}</div>
                  </div>
                </div>
                <button onClick={handleDownload} disabled={downloading}
                        className="w-full px-4 py-3 bg-gold hover:bg-gold/90 text-navy-dark rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                  <Download size={16}/> {downloading ? 'Preparing…' : 'Download backup'}
                </button>
              </>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                {info.message}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-semibold text-navy mb-2 flex items-center gap-2">
              <FileArchive size={16}/> Restore
            </h3>
            <p className="text-sm text-ink-600 mb-3">
              Restoring is intentionally not exposed via the web UI. Replacing a live database while users are connected is high-risk. The recommended workflow is:
            </p>
            <ol className="text-sm text-ink-600 space-y-1.5 list-decimal list-inside ml-2">
              <li>Stop the LMS service on the host</li>
              <li>Replace the database file with the backup (or run <code className="bg-ink-100 px-1 rounded text-xs">pg_restore</code> for Postgres)</li>
              <li>Restart the service</li>
            </ol>
            <p className="text-xs text-ink-500 mt-3 italic">
              Anyone with shell access can do this; the API doesn't need to.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <strong>Backup hygiene:</strong> Take a fresh snapshot before any major update, after large data imports, and on a regular schedule (daily or weekly). The backup contains every lodge's data — store it securely.
          </div>
        </>
      )}
    </div>
  )
}
