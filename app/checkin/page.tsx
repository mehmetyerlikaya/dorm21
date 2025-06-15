"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import useSupabaseData from "@/src/hooks/useSupabaseData"
import useCountdown from "@/src/hooks/useCountdown"
import { canAdjustTime, getOwnershipDisplay, getTimeUntilAdjustmentAvailable, isCurrentUserOwner } from "@/src/utils/machineOwnership"
import { getDeviceUserId } from "@/src/utils/userIdentification"

function CheckInContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const machineId = searchParams.get("machine")
  const { laundry, toggleMachineStatus, reserveMachine, adjustMachineTime, isLoading, refreshData } = useSupabaseData()
  const [machine, setMachine] = useState<any>(null)
  const [actionResult, setActionResult] = useState<string>("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [customTime, setCustomTime] = useState("60")
  const [adjustTime, setAdjustTime] = useState("")
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [adjustResult, setAdjustResult] = useState("")

  const countdown = useCountdown(machine?.endAt, machine?.graceEndAt)

  useEffect(() => {
    if (!machineId) return

    const foundMachine = laundry.find((m) => m.id === machineId)
    setMachine(foundMachine || null)
  }, [machineId, laundry])

  // Reduced auto-refresh to every 10 seconds to prevent conflicts
  useEffect(() => {
    const interval = setInterval(() => {
      refreshData()
    }, 10000)

    return () => clearInterval(interval)
  }, [refreshData])

  const handleToggle = async () => {
    if (!machineId || isProcessing) return

    // Validate time input for free machines
    if (machine?.status === "free") {
      const timeNum = parseInt(customTime)
      if (isNaN(timeNum) || timeNum < 15 || timeNum > 180) {
        setActionResult("Please enter a valid time limit")
        return
      }
    }

    setIsProcessing(true)
    setActionResult("")

    let success = false

    if (machine?.status === "free") {
      // Always use custom time for starting machines
      success = await reserveMachine(machineId, `${customTime} minutes`)
    } else {
      // Use default toggle for stopping/collecting
      success = await toggleMachineStatus(machineId)
    }

    if (success) {
      setActionResult("Status updated successfully!")

      // Single refresh after 2 seconds to confirm the change
      setTimeout(() => refreshData(), 2000)
    } else {
      setActionResult("Error updating machine status")
    }

    setIsProcessing(false)
  }

  const getStatusDisplay = () => {
    if (!machine) return ""

    switch (machine.status) {
      case "free":
        return "🟢 Available"
      case "running":
        const hours = Math.floor(countdown.secondsLeft / 3600)
        const minutes = Math.floor((countdown.secondsLeft % 3600) / 60)
        const seconds = countdown.secondsLeft % 60
        return `🔵 In Use - ${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} left`
      case "finishedGrace":
        // Calculate grace period time remaining
        let graceTimeDisplay = "5:00"

        if (machine.graceEndAt) {
          const graceMinutes = Math.floor(countdown.graceSecondsLeft / 60)
          const graceSeconds = countdown.graceSecondsLeft % 60
          graceTimeDisplay = `${graceMinutes}:${graceSeconds.toString().padStart(2, "0")}`
        }

        return `⚠️ Please collect items - ${graceTimeDisplay} left`
      default:
        return "Unknown"
    }
  }

  const getButtonText = () => {
    if (isProcessing) {
      return (
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          Processing...
        </div>
      )
    }

    const currentUserId = getDeviceUserId()
    const isOwner = machine?.startedByUserId === currentUserId

    switch (machine?.status) {
      case "free":
        return `▶️ Start Using Machine (${customTime} min)`
      case "running":
        return isOwner ? "⏹️ Stop Using Machine" : "🚫 Machine in Use by Another User"
      case "finishedGrace":
        return isOwner ? "✅ I've Collected My Items" : "🚫 Another User's Items"
      default:
        return "Update Status"
    }
  }

  const getButtonColor = () => {
    if (isProcessing) return "bg-gray-400 cursor-not-allowed"

    const currentUserId = getDeviceUserId()
    const isOwner = machine?.startedByUserId === currentUserId

    switch (machine?.status) {
      case "free":
        return "bg-blue-500 hover:bg-blue-600"
      case "running":
        return isOwner ? "bg-red-500 hover:bg-red-600" : "bg-gray-400 cursor-not-allowed"
      case "finishedGrace":
        return isOwner ? "bg-green-500 hover:bg-green-600" : "bg-gray-400 cursor-not-allowed"
      default:
        return "bg-gray-500"
    }
  }

  const isButtonDisabled = () => {
    if (isProcessing) return true

    const currentUserId = getDeviceUserId()
    const isOwner = machine?.startedByUserId === currentUserId

    // Disable if machine is busy and user is not the owner
    if ((machine?.status === "running" || machine?.status === "finishedGrace") && !isOwner) {
      return true
    }

    return false
  }

  const handleBackToHome = () => {
    router.push("/")
  }

  const handleAdjustTime = async () => {
    if (!machineId || isAdjusting) return

    const minutesNum = parseInt(adjustTime)
    if (isNaN(minutesNum) || minutesNum < 1 || minutesNum > 120) {
      setAdjustResult("Please enter a number between 1-120 minutes")
      return
    }

    setIsAdjusting(true)
    setAdjustResult("")

    const result = await adjustMachineTime(machineId, minutesNum)

    if (result.success) {
      setAdjustResult("Timer updated successfully")
      setAdjustTime("")
      // Refresh data after successful adjustment
      setTimeout(() => refreshData(), 1000)
    } else {
      setAdjustResult(result.error || "Failed to update timer")
    }

    setIsAdjusting(false)
  }

  // Custom display names for machines (same logic as LaundryCard)
  const getDisplayName = (machine: any) => {
    if (!machine) return ""

    const isWasher = machine.name.toLowerCase().includes("washer")

    if (isWasher) {
      // Extract number from washer name (e.g., "Washer 1" -> "1")
      const numberMatch = machine.name.match(/\d+/)
      const number = numberMatch ? numberMatch[0] : ""
      return `Washer ${number}`
    } else {
      // For dryers, use "Dryer 5" through "Dryer 8" based on original number
      const numberMatch = machine.name.match(/\d+/)
      const originalNumber = numberMatch ? Number.parseInt(numberMatch[0]) : 0
      const newNumber = originalNumber + 4 // Map 1->5, 2->6, 3->7, 4->8
      return `Dryer ${newNumber}`
    }
  }

  if (isLoading && !machine) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-lg">Getting machine information...</div>
        </div>
      </div>
    )
  }

  if (!machineId) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="text-red-600 text-lg mb-4">Error</div>
          <div className="text-gray-600">No machine ID provided.</div>
        </div>
      </div>
    )
  }

  if (!machine) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="text-red-600 text-lg mb-4">Machine Not Found</div>
          <div className="text-gray-600 mb-4">The requested machine could not be found.</div>
          <button onClick={refreshData} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded">
            Retry Loading
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow text-center max-w-md w-full mx-4">
        <h1 className="text-2xl font-bold mb-4">Machine Check-In</h1>

        {/* QR Code for this specific check-in page */}
        <div className="mb-6">
          <div className="text-sm text-gray-600 mb-3">Scan to access this page</div>
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded-lg border-2 border-gray-200 shadow-sm">
              <QRCodeSVG
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/checkin?machine=${machineId}`}
                size={80}
                fgColor="#1A1F36"
                bgColor="#FFFFFF"
              />
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="text-lg font-medium">{getDisplayName(machine)}</div>
          <div
            className={`text-sm mt-1 font-semibold ${
              machine.status === "free"
                ? "text-green-600"
                : machine.status === "running"
                  ? "text-blue-600"
                  : machine.status === "finishedGrace"
                    ? "text-orange-600"
                    : "text-red-600"
            } ${machine.status === "finishedGrace" ? "animate-pulse" : ""}`}
          >
            Status: {getStatusDisplay()}
          </div>

          {machine.status === "running" && machine.endAt && (
            <div className="text-xs text-gray-500 mt-1">Ends at: {machine.endAt.toLocaleTimeString()}</div>
          )}

          {machine.status === "finishedGrace" && machine.graceEndAt && (
            <div className="text-xs text-orange-500 mt-1">
              Grace period ends at: {machine.graceEndAt.toLocaleTimeString()}
            </div>
          )}

          {/* Ownership display */}
          {machine.startedByUserId && (
            <div className="text-xs text-gray-600 mt-2">
              {getOwnershipDisplay(machine)}
            </div>
          )}

          {/* Warning for busy machines */}
          {(machine.status === "running" || machine.status === "finishedGrace") && !isCurrentUserOwner(machine) && (
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="text-sm font-medium text-yellow-800 mb-1">⚠️ Machine Unavailable</div>
              <div className="text-xs text-yellow-700">
                This machine is currently being used by another user. Only they can stop it or collect their items.
              </div>
            </div>
          )}
        </div>

        {/* Time limit input - always show when machine is free */}
        {machine.status === "free" && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-sm font-medium text-blue-800 mb-2">Set Time Limit</div>
            <div className="flex items-center justify-center gap-2">
              <input
                type="number"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                placeholder="Enter minutes"
                className="border border-gray-300 rounded-md p-3 w-24 text-center text-lg font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-sm text-gray-600 font-medium">minutes</span>
            </div>
            <div className="text-xs text-blue-600 mt-2 text-center">
              Add a time limit accordingly
            </div>
          </div>
        )}

        {/* Time adjustment section - show for machines you own and are running */}
        {machine.status === "running" && isCurrentUserOwner(machine) && (
          <>
            {canAdjustTime(machine) ? (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-sm font-medium text-blue-800 mb-2">Adjust Timer</div>
                <div className="text-xs text-blue-600 mb-3">
                  Current: {machine.endAt ? Math.max(0, Math.ceil((machine.endAt.getTime() - Date.now()) / (1000 * 60))) : 0} minutes remaining
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="number"
                    value={adjustTime}
                    onChange={(e) => setAdjustTime(e.target.value)}
                    placeholder="Minutes (1-120)"
                    min="1"
                    max="120"
                    disabled={isAdjusting}
                    className="flex-1 border rounded p-2 text-center text-sm"
                  />
                  <button
                    onClick={handleAdjustTime}
                    disabled={isAdjusting || !adjustTime}
                    className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isAdjusting && (
                      <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                    )}
                    {isAdjusting ? "Updating..." : "Update Timer"}
                  </button>
                </div>

                {adjustResult && (
                  <div className={`text-xs p-2 rounded ${
                    adjustResult.includes("successfully")
                      ? "bg-green-100 text-green-800 border border-green-200"
                      : "bg-red-100 text-red-800 border border-red-200"
                  }`}>
                    {adjustResult}
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-sm font-medium text-gray-600 mb-2">Timer Adjustment</div>
                <div className="text-xs text-gray-500">
                  Available in {getTimeUntilAdjustmentAvailable(machine)} minutes
                </div>
              </div>
            )}
          </>
        )}

        <button
          onClick={handleToggle}
          disabled={isButtonDisabled()}
          className={`w-full p-3 rounded text-white font-medium mb-4 ${getButtonColor()}`}
        >
          {getButtonText()}
        </button>

        {/* Back to Home Button */}
        <button
          onClick={handleBackToHome}
          className="w-full p-3 rounded-lg bg-gray-800 hover:bg-gray-900 text-white font-medium mb-4 transition-colors duration-200 shadow-md"
        >
          ← Back to Home
        </button>

        {actionResult && (
          <div
            className={`text-sm mb-4 p-2 rounded ${
              actionResult.includes("Error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
            }`}
          >
            {actionResult}
          </div>
        )}

        {machine.status === "finishedGrace" && (
          <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm text-orange-800">
            <div className="font-medium mb-1">⚠️ Grace Period Active</div>
            <div>
              Please collect your items within the time limit. The machine will become available automatically when the
              grace period ends.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CheckInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    }>
      <CheckInContent />
    </Suspense>
  )
}