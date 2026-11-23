package tw.nori.dest.walk

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import tw.nori.dest.R

/** Health Connect 授權畫面的「隱私權政策」會開這一頁；沒有它，系統不會給權限。 */
class WalkRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setText(R.string.walk_rationale)
            textSize = 16f
            setPadding(pad, pad * 2, pad, pad)
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
