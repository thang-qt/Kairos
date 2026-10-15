package server

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"sync"
	"time"
)

func (service *assetService) startCleanup(commandMu *sync.Mutex) {
	ctx, cancel := context.WithCancel(context.Background())
	service.cleanupCancel = cancel
	service.cleanupWG.Add(1)
	go func() {
		defer service.cleanupWG.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			if ctx.Err() != nil {
				return
			}
			if err := service.cleanupBatch(ctx, commandMu); err != nil && ctx.Err() == nil {
				log.Printf("kairos: asset cleanup: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (service *assetService) closeCleanup() {
	service.cleanupOnce.Do(func() {
		if service.cleanupCancel != nil {
			service.cleanupCancel()
		}
		service.cleanupWG.Wait()
	})
}

func (service *assetService) cleanupBatch(ctx context.Context, commandMu *sync.Mutex) error {
	for range 32 {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		job, err := service.claimCleanup(ctx, commandMu)
		if err != nil {
			return err
		}
		if job == nil {
			return nil
		}
		store := service.stores[job.Backend]
		var deleteErr error
		if store == nil {
			deleteErr = errors.New("asset storage is not configured")
		} else {
			deleteCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			deleteErr = store.Delete(deleteCtx, job.Key)
			cancel()
		}
		if deleteErr != nil {
			// Keep the durable job, including its storage location, for a later retry.
			if _, err := service.db.ExecContext(ctx, `UPDATE asset_cleanup_jobs SET available_at=? WHERE asset_id=?`, time.Now().Add(time.Minute).UnixMilli(), job.ID); err != nil {
				return err
			}
			log.Printf("kairos: retry asset cleanup: %v", deleteErr)
			continue
		}
		if _, err := service.db.ExecContext(ctx, `DELETE FROM asset_cleanup_jobs WHERE asset_id=?`, job.ID); err != nil {
			return err
		}
	}
	return nil
}

func (service *assetService) claimCleanup(ctx context.Context, commandMu *sync.Mutex) (*assetRecord, error) {
	// Import uploads are protected separately so they never hold the command lock.
	if !service.importWrites.TryLock() {
		return nil, nil
	}
	defer service.importWrites.Unlock()
	// Writers can temporarily own an asset before committing its message. Claim
	// only between commands; never hold their lock while contacting object storage.
	if !commandMu.TryLock() {
		return nil, nil
	}
	defer commandMu.Unlock()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var job assetRecord
	var claimed int
	err = tx.QueryRowContext(ctx, `SELECT asset_id,backend,object_key,claimed FROM asset_cleanup_jobs WHERE available_at<=? ORDER BY available_at,asset_id LIMIT 1`, time.Now().UnixMilli()).Scan(&job.ID, &job.Backend, &job.Key, &claimed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if claimed == 0 {
		var referenced bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chat_asset_references WHERE asset_id=?)`, job.ID).Scan(&referenced); err != nil {
			return nil, err
		}
		if referenced {
			if _, err := tx.ExecContext(ctx, `DELETE FROM asset_cleanup_jobs WHERE asset_id=?`, job.ID); err != nil {
				return nil, err
			}
			// A referenced candidate does not consume an object deletion, but yields
			// to foreground work rather than scanning an entire user's asset library.
			return nil, tx.Commit()
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM chat_assets WHERE id=?`, job.ID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE asset_cleanup_jobs SET claimed=1 WHERE asset_id=?`, job.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &job, nil
}
