<?php
/**
 * Plugin Name: SEO Check — campi Yoast via REST
 * Description: Permette a SEO Check di scrivere il titolo SEO e la meta description di Yoast tramite le API di WordPress. Non modifica nient'altro.
 * Version: 1.0
 * Author: SEO Check
 *
 * PERCHÉ SERVE
 * Yoast salva il titolo SEO e la meta description in campi "protetti"
 * (_yoast_wpseo_title, _yoast_wpseo_metadesc). WordPress accetta le richieste
 * di scrittura su campi protetti ma le ignora silenziosamente, a meno che il
 * sito non li dichiari esplicitamente disponibili per le API — che è
 * esattamente ciò che fa questo file, e nient'altro.
 *
 * SICUREZZA
 * Chi scrive deve comunque essere autenticato e avere il permesso di
 * modificare quel contenuto (edit_post): questo file non concede a nessuno
 * accessi che non avesse già, apre solo due campi specifici.
 *
 * COME INSTALLARLO
 * Opzione A (consigliata) — caricalo via FTP o File Manager dell'hosting in:
 *   wp-content/mu-plugins/seocheck-yoast-rest.php
 * (se la cartella mu-plugins non esiste, creala). Si attiva da solo.
 *
 * Opzione B — Plugin → Aggiungi nuovo → Carica plugin, poi attivalo.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', function () {
    $fields = [
        '_yoast_wpseo_title'    => 'Titolo SEO (Yoast)',
        '_yoast_wpseo_metadesc' => 'Meta description (Yoast)',
    ];

    // Ogni tipo di contenuto pubblico: articoli, pagine e i prodotti WooCommerce.
    $post_types = get_post_types(['public' => true], 'names');

    foreach ($post_types as $post_type) {
        foreach ($fields as $key => $description) {
            register_post_meta($post_type, $key, [
                'type'          => 'string',
                'single'        => true,
                'description'   => $description,
                'show_in_rest'  => true,
                'auth_callback' => function ($allowed, $meta_key, $post_id) {
                    // Solo chi può già modificare quel contenuto.
                    return current_user_can('edit_post', $post_id);
                },
            ]);
        }
    }
}, 20);
