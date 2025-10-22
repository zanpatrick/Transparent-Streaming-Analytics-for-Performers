(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-CONTENT-ID u101)
(define-constant ERR-INVALID-PERFORMER-ID u102)
(define-constant ERR-INVALID-LISTENER-ID u103)
(define-constant ERR-INVALID-GEO-REGION u104)
(define-constant ERR-INVALID-DEVICE-TYPE u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-INVALID-ORACLE-SIGNATURE u107)
(define-constant ERR-RATE-LIMIT-EXCEEDED u108)
(define-constant ERR-STREAM-ALREADY-EXISTS u109)
(define-constant ERR-STREAM-NOT-FOUND u110)
(define-constant ERR-INVALID-BATCH-SIZE u111)
(define-constant ERR-INVALID-TIME-RANGE u112)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u113)
(define-constant ERR-INVALID-MAX-STREAMS u114)
(define-constant ERR-INVALID-LOG-FEE u115)
(define-constant ERR-INVALID-STATUS u116)
(define-constant ERR-INVALID-UPDATE-PARAM u117)
(define-constant ERR-MAX-STREAMS-EXCEEDED u118)
(define-constant ERR-INVALID-ENGAGEMENT-TYPE u119)
(define-constant ERR-INVALID-DURATION u120)

(define-data-var next-stream-id uint u0)
(define-data-var max-streams uint u1000000)
(define-data-var log-fee uint u10)
(define-data-var authority-contract (optional principal) none)
(define-data-var oracle-public-key (buff 33) 0x000000000000000000000000000000000000000000000000000000000000000000)

(define-map stream-events
  uint
  {
    content-id: uint,
    performer-id: principal,
    listener-id: (optional principal),
    geo-region: uint,
    device-type: uint,
    timestamp: uint,
    engagement-type: uint,
    duration: uint,
    oracle-signature: (buff 65),
    status: bool
  }
)

(define-map stream-counts-by-content
  uint
  uint
)

(define-map streams-by-timestamp
  { content-id: uint, timestamp: uint }
  (list 100 uint)
)

(define-map stream-updates
  uint
  {
    update-timestamp: uint,
    update-duration: uint,
    updater: principal
  }
)

(define-read-only (get-stream (id uint))
  (map-get? stream-events id)
)

(define-read-only (get-stream-count (content-id uint))
  (default-to u0 (map-get? stream-counts-by-content content-id))
)

(define-read-only (get-streams-in-range (content-id uint) (start-time uint) (end-time uint))
  (fold append-streams-in-range (unwrap! (get-timestamps-for-range content-id start-time end-time) (list)) (list))
)

(define-read-only (get-stream-updates (id uint))
  (map-get? stream-updates id)
)

(define-private (validate-content-id (id uint))
  (if (> id u0)
      (ok true)
      (err ERR-INVALID-CONTENT-ID))
)

(define-private (validate-performer-id (id principal))
  (if (not (is-eq id 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-PERFORMER-ID))
)

(define-private (validate-geo-region (region uint))
  (if (<= region u1000)
      (ok true)
      (err ERR-INVALID-GEO-REGION))
)

(define-private (validate-device-type (type uint))
  (if (<= type u10)
      (ok true)
      (err ERR-INVALID-DEVICE-TYPE))
)

(define-private (validate-timestamp (ts uint))
  (if (and (>= ts block-height) (< ts (+ block-height u144)))
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-engagement-type (type uint))
  (if (<= type u5)
      (ok true)
      (err ERR-INVALID-ENGAGEMENT-TYPE))
)

(define-private (validate-duration (dur uint))
  (if (and (> dur u0) (<= dur u3600))
      (ok true)
      (err ERR-INVALID-DURATION))
)

(define-private (validate-oracle-signature (sig (buff 65)) (message (buff 128)))
  (if (secp256k1-verify (sha256 message) sig (var-get oracle-public-key))
      (ok true)
      (err ERR-INVALID-ORACLE-SIGNATURE))
)

(define-private (validate-rate-limit (content-id uint))
  (let ((count (get-stream-count content-id)))
    (if (< count u10000)
        (ok true)
        (err ERR-RATE-LIMIT-EXCEEDED)))
)

(define-private (get-timestamps-for-range (content-id uint) (start uint) (end uint))
  (filter timestamp-in-range (unwrap! (map-get? streams-by-timestamp {content-id: content-id, timestamp: start}) (list)))
)

(define-private (timestamp-in-range (ts uint))
  (and (>= ts start-time) (<= ts end-time))
)

(define-private (append-streams-in-range (ts uint) (acc (list 100 uint)))
  (unwrap! (as-max-len? (append acc ts) u100) acc)
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-oracle-public-key (pubkey (buff 33)))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (is-eq tx-sender (unwrap! (var-get authority-contract) (err ERR-NOT-AUTHORIZED))) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-public-key pubkey)
    (ok true)
  )
)

(define-public (set-max-streams (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-MAX-STREAMS))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-streams new-max)
    (ok true)
  )
)

(define-public (set-log-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-LOG-FEE))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set log-fee new-fee)
    (ok true)
  )
)

(define-public (log-stream
  (content-id uint)
  (performer-id principal)
  (listener-id (optional principal))
  (geo-region uint)
  (device-type uint)
  (timestamp uint)
  (engagement-type uint)
  (duration uint)
  (oracle-signature (buff 65))
)
  (let (
        (next-id (var-get next-stream-id))
        (current-max (var-get max-streams))
        (authority (var-get authority-contract))
        (message (concat (concat (int-to-ascii content-id) (principal-to-ascii performer-id)) (int-to-ascii timestamp)))
      )
    (asserts! (< next-id current-max) (err ERR-MAX-STREAMS-EXCEEDED))
    (try! (validate-content-id content-id))
    (try! (validate-performer-id performer-id))
    (try! (validate-geo-region geo-region))
    (try! (validate-device-type device-type))
    (try! (validate-timestamp timestamp))
    (try! (validate-engagement-type engagement-type))
    (try! (validate-duration duration))
    (try! (validate-oracle-signature oracle-signature (sha256 message)))
    (try! (validate-rate-limit content-id))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (stx-transfer? (var-get log-fee) tx-sender (unwrap! authority (err ERR-NOT-AUTHORIZED))))
    (map-set stream-events next-id
      {
        content-id: content-id,
        performer-id: performer-id,
        listener-id: listener-id,
        geo-region: geo-region,
        device-type: device-type,
        timestamp: timestamp,
        engagement-type: engagement-type,
        duration: duration,
        oracle-signature: oracle-signature,
        status: true
      }
    )
    (map-set stream-counts-by-content content-id (+ (get-stream-count content-id) u1))
    (map-set streams-by-timestamp {content-id: content-id, timestamp: timestamp}
      (unwrap! (as-max-len? (append (default-to (list) (map-get? streams-by-timestamp {content-id: content-id, timestamp: timestamp})) next-id) u100) (err ERR-INVALID-BATCH-SIZE)))
    (var-set next-stream-id (+ next-id u1))
    (print { event: "stream-logged", id: next-id })
    (ok next-id)
  )
)

(define-public (update-stream-duration
  (stream-id uint)
  (new-duration uint)
)
  (let ((stream (map-get? stream-events stream-id)))
    (match stream
      s
        (begin
          (asserts! (is-eq (get performer-id s) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-duration new-duration))
          (map-set stream-events stream-id
            (merge s { duration: new-duration }))
          (map-set stream-updates stream-id
            {
              update-timestamp: block-height,
              update-duration: new-duration,
              updater: tx-sender
            }
          )
          (print { event: "stream-updated", id: stream-id })
          (ok true)
        )
      (err ERR-STREAM-NOT-FOUND)
    )
  )
)

(define-public (verify-stream-batch (stream-ids (list 100 uint)))
  (fold verify-single-stream stream-ids (ok true))
)

(define-private (verify-single-stream (id uint) (acc (response bool uint)))
  (match acc
    prev-ok
      (let ((stream (get-stream id)))
        (match stream
          s (ok (and prev-ok (get status s)))
          (ok prev-ok)
        )
      )
    prev-err prev-err
  )
)

(define-public (get-total-streams)
  (ok (var-get next-stream-id))
)