package app.seans.tv.designsystem

import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The side rail of Home: 72 dp wide with icons only; it opens to 220 dp with labels while it holds
 * focus. It lies over the content (content starts at 104 dp). Which item is focusable when, and
 * how focus enters and leaves it, is the screen's job (see `HomeScreen`).
 */
@Composable
fun SeansRail(
    open: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.(open: Boolean) -> Unit,
) {
    val width by animateDpAsState(
        if (open) SeansSpace.RailOpen else SeansSpace.RailCollapsed,
        tween(SeansMotion.Screen, easing = SeansMotion.Ease), label = "railWidth",
    )
    val openness by animateFloatAsState(if (open) 1f else 0f, tween(SeansMotion.Screen, easing = SeansMotion.Ease), label = "railOpen")
    Column(
        modifier
            .width(width)
            .fillMaxHeight()
            .drawBehind {
                val o = openness
                // Collapsed: rgba(9,9,11,.92) → transparent. Open: .98 until 60%, then .86, plus a soft shadow.
                drawRect(
                    Brush.horizontalGradient(
                        0f to SeansColors.Bg.copy(alpha = 0.92f + 0.06f * o),
                        0.6f to SeansColors.Bg.copy(alpha = 0.55f + 0.43f * o),
                        1f to SeansColors.Bg.copy(alpha = 0.86f * o),
                    ),
                )
                if (o > 0f) {
                    val shadow = 48.dp.toPx()
                    drawRect(
                        Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.5f * o), Color.Transparent), startX = size.width, endX = size.width + shadow),
                        topLeft = Offset(size.width, 0f),
                        size = Size(shadow, size.height),
                    )
                }
            }
            .padding(vertical = SeansSpace.SafeY, horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            Modifier.height(36.dp).padding(start = 12.dp).padding(bottom = 0.dp).clipToBounds(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(painterResource(SeansIcons.Logo), contentDescription = null, modifier = Modifier.size(24.dp))
            SText("Сеанс", SeansText.Brand.copy(fontSize = 17.sp), Modifier.wrapContentWidth(Alignment.Start, unbounded = true).alpha(openness), maxLines = 1)
        }
        Spacer(Modifier.height(22.dp - 6.dp))
        content(open)
    }
}

/** Shared frame of a rail entry: 44 dp, the current-page bar, white when focused. */
@Composable
private fun RailEntry(
    current: Boolean,
    open: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
    leading: @Composable (Color) -> Unit,
    label: String,
    dot: Boolean = false,
) {
    val interaction = rememberFocusInteraction()
    val focused = interaction.focused
    val fill by animateColorAsState(if (focused) SeansColors.Text else Color.Transparent, tween(SeansMotion.Focus), label = "railFill")
    val content = when {
        focused -> SeansColors.OnFocus
        current -> SeansColors.Text
        else -> SeansColors.Text2
    }
    val labelAlpha by animateFloatAsState(if (open) 1f else 0f, tween(160, easing = SeansMotion.Ease), label = "railLabel")
    Box(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .seansClickable(interaction, 1f, description = label, onClick = onClick)
            .roundedFill({ fill }, SeansRadius.Md),
    ) {
        if (current) {
            Box(
                Modifier
                    .offset(x = 3.dp, y = 14.dp)
                    .size(3.dp, 16.dp)
                    .roundedFill(if (focused) SeansColors.Bg else SeansColors.Text, 2.dp),
            )
        }
        Row(
            Modifier.fillMaxHeight().padding(horizontal = 14.dp).clipToBounds(),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            leading(content)
            SText(label, SeansText.Button, Modifier.wrapContentWidth(Alignment.Start, unbounded = true).alpha(labelAlpha), color = content, maxLines = 1)
        }
        if (dot) {
            Box(
                Modifier
                    .offset(x = 29.dp, y = 9.dp)
                    .size(11.dp)
                    .roundedFill(SeansColors.Bg, SeansRadius.Sm)
                    .padding(2.dp)
                    .roundedFill(SeansColors.Danger, SeansRadius.Xs),
            )
        }
    }
}

/** A page of the rail: an icon, a label shown when open, an optional red «live» dot. */
@Composable
fun RailItem(
    @DrawableRes icon: Int,
    label: String,
    current: Boolean,
    open: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    dot: Boolean = false,
) {
    RailEntry(current, open, onClick, modifier, leading = { SeansIcon(icon, tint = it) }, label = label, dot = dot)
}

/** The account entry at the bottom: the user's avatar (the only circle in the interface) and name. */
@Composable
fun RailUserItem(
    initial: String,
    label: String,
    open: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    RailEntry(false, open, onClick, modifier, leading = { _ -> Avatar(initial) }, label = label)
}

/** The user's avatar: a circle (the only one), initial on a dark gradient. */
@Composable
fun Avatar(initial: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .requiredSize(26.dp)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(Color(0xFF3F3F46), Color(0xFF18181B))))
            .border(1.dp, SeansColors.Line2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        SText(initial, SeansText.Badge, color = SeansColors.Text, maxLines = 1)
    }
}
