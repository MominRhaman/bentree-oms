<?php
/**
 * Plugin Name: Bentree refund restock cap
 * Description: A refund with "Restock refunded items" never gives back more units than the order line still holds (_reduced_stock). Bentree OMS gives returned / exchanged-out items back itself and marks those units as no longer held, so WooCommerce must not restock them a second time.
 * Version: 1.0.0
 *
 * WooCommerce 11.3 wc_restock_refunded_items() restocks the full refunded
 * quantity of a line whenever its _reduced_stock is non-zero, without
 * comparing the two. This filter runs before that, stops the uncapped
 * restock and runs WooCommerce's own wc_restock_refunded_items() again with
 * each line's quantity limited to its remaining _reduced_stock. The refund
 * itself (amount, refunded quantities, refund record) is not changed.
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'woocommerce_can_restock_refunded_items',
	function ( $can_restock, $order, $refunded_line_items ) {
		static $running = false;

		// Our own capped call below: let WooCommerce restock it.
		if ( $running || ! $can_restock || ! $order instanceof WC_Order ) {
			return $can_restock;
		}

		$capped = array();
		$limited = array();
		foreach ( $order->get_items() as $item_id => $item ) {
			if ( ! isset( $refunded_line_items[ $item_id ], $refunded_line_items[ $item_id ]['qty'] ) ) {
				continue;
			}
			$requested = (int) $refunded_line_items[ $item_id ]['qty'];
			$held      = max( 0, (int) $item->get_meta( '_reduced_stock', true ) );
			$qty       = min( $requested, $held );
			if ( $qty > 0 ) {
				$capped[ $item_id ]        = $refunded_line_items[ $item_id ];
				$capped[ $item_id ]['qty'] = $qty;
			}
			if ( $qty < $requested ) {
				$limited[] = sprintf( '%s: %d of %d', $item->get_name(), $qty, $requested );
			}
		}

		if ( $limited ) {
			$order->add_order_note(
				'Refund restock limited to the units this order still holds (the rest were already returned to stock): ' . implode( ', ', $limited ) . '.'
			);
		}

		if ( $capped ) {
			$running = true;
			try {
				wc_restock_refunded_items( $order, $capped );
			} finally {
				$running = false;
			}
		}

		// The uncapped restock must not run.
		return false;
	},
	10,
	3
);
