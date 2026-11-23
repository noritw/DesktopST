package tw.nori.dest.walk

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 讀步數，外掛與小工具共用（`docs/walk-together-design.md` §3）。
 *
 * ⚠️ **一定用 aggregate，不要 readRecords 再自己加總**：手機與手錶會同時寫入，
 * 只有彙總會處理重疊；逐筆讀還有翻頁上限的坑。
 * 不篩 DataOrigin，手機內建計步才會被算進去。
 */
object WalkSteps {
    val STEPS_PERMISSION = HealthPermission.getReadPermission(StepsRecord::class)
    const val BACKGROUND_PERMISSION = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND

    const val OK = "ok"
    const val UNSUPPORTED = "unsupported"
    const val NEEDS_UPDATE = "needs_update"
    const val NO_PERMISSION = "no_permission"

    data class Status(val state: String, val backgroundSupported: Boolean, val backgroundGranted: Boolean)

    fun client(context: Context): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    fun sdkState(context: Context): String = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> OK
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> NEEDS_UPDATE
        else -> UNSUPPORTED
    }

    fun backgroundSupported(context: Context): Boolean = try {
        client(context).features.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (_: Exception) {
        false
    }

    suspend fun status(context: Context): Status {
        val sdk = sdkState(context)
        if (sdk != OK) return Status(sdk, false, false)
        val granted = client(context).permissionController.getGrantedPermissions()
        return Status(
            state = if (STEPS_PERMISSION in granted) OK else NO_PERMISSION,
            backgroundSupported = backgroundSupported(context),
            backgroundGranted = BACKGROUND_PERMISSION in granted
        )
    }

    /** 某個當地日期的總步數；讀取成功但完全沒有資料時回 `null`，讀取失敗會擲例外。 */
    suspend fun readDay(context: Context, day: LocalDate): Long? {
        val zone = ZoneId.systemDefault()
        val start = day.atStartOfDay(zone).toInstant()
        val end = minOf(day.plusDays(1).atStartOfDay(zone).toInstant(), Instant.now())
        if (!end.isAfter(start)) return null
        val result = client(context).aggregate(
            AggregateRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end)
            )
        )
        return result[StepsRecord.COUNT_TOTAL]
    }
}
